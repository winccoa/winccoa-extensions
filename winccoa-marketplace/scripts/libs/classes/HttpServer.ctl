#uses "std"
#uses "CtrlXml"
#uses "CtrlHTTP"
#uses "CtrlPv2Admin"
#uses "classes/auth/OaAuthServerside"
#uses "classes/auth/OaAuthFactory"
#uses "classes/wssServer/WebUiHttpEndpoints"
#uses "classes/wssServer/WebUiTokenProviderService"
#uses "classes/restServer/PmAgentHttpEndpoints"
#uses "classes/restServer/RptHttpEndpoints"
#uses "classes/oidc/OidcHttpEndpoints"
#uses "classes/marketplace/MarketplaceEndpoints"


enum HttpServerSecurityLevel
{
  DEFAULT = 0, // no special security
  LOW     = 1, // no access to certificates
  HIGH    = 2  // retricted access, only ULC UX and Remote UI are allowed
};


/* Base Implementation for the HTTP server features needed for
   the UserInterface running on mobile clients and as Desktop-UI
*/

class HttpServer
{
  public HttpServer()
  {
    string user;

    // We only need the OS user on unix
    if ( _UNIX )
    {
      mapping userInfo = getOSUser();
      user = userInfo.value("Name", "");
    }

    if ( _WIN32 || (user == "root") )
    {
      httpPort  = paCfgReadValueDflt(CONFIG_FILE, "webClient", "httpPort",   80);
      httpsPort = paCfgReadValueDflt(CONFIG_FILE, "webClient", "httpsPort", 443);
    }
    else
    {
      // on unix, ports < 1024 are not available for non-root users
      // therefore open alternative ports
      httpPort  = paCfgReadValueDflt(CONFIG_FILE, "webClient", "httpPort",  8080);
      httpsPort = paCfgReadValueDflt(CONFIG_FILE, "webClient", "httpsPort", 8079);
    }

    // check if hardened variant of webserver should be used
    securityLevel = paCfgReadValueDflt(CONFIG_FILE,
                                       "webClient",
                                       "advancedSecurity",
                                       (int)HttpServerSecurityLevel::DEFAULT);

    // get server authentication setting
    int httpAuthCfg;
    if ( paCfgReadValue(CONFIG_FILE, "webClient", "httpAuth", httpAuthCfg) == 0 )
    {
      httpAuth = (httpAuthCfg == 1);
    }

    OaAuthServerside auth;
    authServerSide = auth;
    isServerSideLoginEnabled = authServerSide.isServerSideAuthEnabled();

    ulcNeedAuth = httpAuth || isServerSideLoginEnabled;
    DebugFTN("HTTP", "ulcNeedAuth", ulcNeedAuth);

    lowestAutoManNumMobileUI = paCfgReadValueDflt(CONFIG_FILE, "webClient", "LowestAutoManNumMobileUI", 200);

    switch ( paCfgReadValueDflt(CONFIG_FILE, "webClient", "clientProjExt", 0) )
    {
      case 1: // Hostname
      {
        projectExtension = "_" + eventHost().at(0);
        break;
      }
      case 2: // both Redu Hostnames
      {
        if ( isRedundant() )
          projectExtension = "_" + eventHost().at(0) + "_" + eventHost().at(1);
        break;
      }
    }
  }

  public static void setHttpPort(int port) { httpPort = port; }
  public static int getHttpPort() { return httpPort; }

  public static void setHttpsPort(int port) { httpsPort = port; }
  public static int getHttpsPort() { return httpsPort; }

  public static void setHttpAuth(mixed auth) { httpAuth = auth; }
  public static mixed getHttpAuth() { return httpAuth; }

  /* start the http server and open the listener ports
     @return 0 when the server could start and open all ports, otherwise < 0
  */
  public int start()
  {
    if ( isServerSideLoginEnabled )
    {
      // when a ui manager goes online or offline we need to handle this
      dpConnect("cbHandleUiConnections", FALSE, "_Connections.Ui.ManNums", "_Connections_2.Ui.ManNums");
      // connect to SessionTokenTemp to handle tokens coming from more than one
      dpConnect("cbHandleSessionTokens", FALSE, "_System.Auth.SessionTokenInterface");

      // Server Side Login requires the 'Basic' authentication method
      httpAuth = "Basic";

      if ( httpsPort == 0 )
      {
        throwError(makeError("", PRIO_SEVERE, ERR_PARAM, (int)ErrCode::UNEXPECTEDSTATE, "Server Side Authentication requires HTTPS"));
        return -1;
      }
    }
    else if ( httpAuth == UNDEFD_AUTH )
    {
      // SSO requires 'Negotiate' authentication method, this is only selected
      // when there is no httpAuth config entry
      OaAuthFactory authFactory;
      shared_ptr<OaAuthMethod> auth = authFactory.getAuth();
      if ( auth.getBaseType() == "OaAuthMethodAD" )
      {
        // OS authentication is activated - this doesn't mean that SSO is activated as well,
        // but further checks are based on the user that tries to log in.
        // The only thing that can be checked is whether the SSO bit is set for this server
        // for at least one group.

        const int SSO_BIT = 31; // bit 32 is on index 31
        string hostname = getHostname();

        // get WS permissions
        dyn_string displayNames;
        dyn_bit32 permissions;
        dpGet("_WsPermission.Permission",  permissions, "_WsPermission.DisplayName", displayNames);

        if (dynlen(permissions) < dynlen(displayNames))
          permissions[dynlen(displayNames)] = 0;

        bool ssoBitSet = false;
        for (int i = 1; i <= dynlen(displayNames); i++)
        {
          if (stricmp(hostname, displayNames[i]) == 0)
          {
            if (getBit(permissions[i], SSO_BIT))
            {
              // there's at least one group for which the SSO_BIT is set for this server,
              // so SSO is potentially possible - use "Negotiate" method so that SSO does
              // work if actually enabled
              ssoBitSet = true;
              break;
            }
          }
        }

        if (getKerberosSecurity() > 0) // Kerberos does not need an SSO bit to do SSO
        {
          httpAuth = "Negotiate";
          DebugFTN("HTTP", "HTTP authentication method set to Negotiate");
        }
        else if (ssoBitSet)
        {
            httpAuth = "NTLM";
            DebugFTN("HTTP", "HTTP authentication method set to NTLM");
        }
        else
        {
          DebugFTN("HTTP", "OS user authentication activated, but neither the SSO bit is set for this host nor Kerberos is active");
        }
      }
      else
        httpAuth = false;
    }

    int rc = httpServer(httpAuth, httpPort, httpsPort);  // start http Server

    if ( rc != 0 )
    {
      throwError(makeError("", PRIO_WARNING, ERR_CONTROL, (int)ErrCode::UNEXPECTEDSTATE, "httpServer could not be started"));
      return rc;
    }

    // default permission if no rule is found: no access if hardened
    bool highSecurity = securityLevel == HttpServerSecurityLevel::HIGH;
    httpSetDefaultPermission(!highSecurity);
    const mapping allowAll = highSecurity ? ALLOW_ALL_HIGH : ALLOW_ALL;

    // ULC UX permissions - access must be able also when hardened
    httpSetPermission("/data/html/*",          allowAll);
    httpSetPermission("/data/ulc/start.html",  allowAll);
    httpSetPermission("/pictures/*",           allowAll);
    httpSetPermission("/favicon.ico",          allowAll);
    httpSetPermission("/authInfo",             allowAll);
    httpSetPermission("/data/ulc/config.json", allowAll);
    if (highSecurity)
      httpSetPermission("/data/ulc/*", makeMapping("allowUsers", "*",
                                                   "allowUnknownUsers", false,
                                                   "allowDisabledUsers", false));

    httpConnect("authInfo",       "/authInfo");
    httpConnect("handleUlcLogin", "/data/html/login/index.html");
    httpConnect("ulcConfig",      "/data/ulc/config.json", "application/json");

    int maxLogSize, maxContentSize;

    // check if the maxLogFileSize was set in the config file
    paCfgReadValue(CONFIG_FILE, "general", "maxLogFileSize", maxLogSize);

    // if no value was defined use the default of 10 MB
    if ( maxLogSize == 0 )
      maxLogSize = 10;

    // calculate the max content size in bytes
    // *2, because maxLogSize is not a hard limit and checked only every 30 seconds
    //  => can be up to 2 times larger
    maxContentSize = maxLogSize * 1024 * 1024 * 2;

    // set the max content size
    httpSetMaxContentLength(maxContentSize);

    //if serverSideAuth is enabled - set necessary permissions for _info URL
    if (isServerSideLoginEnabled)
    {
      bool bAllowUnknownUsers  = TRUE;
      bool bCheckPassword      = TRUE;
      bool bAllowDisabledUsers = FALSE;
      authServerSide.getHttpPermissions(bAllowUnknownUsers,bCheckPassword,bAllowDisabledUsers);
      httpSetPermission("/_info", makeMapping("allowUsers", "*",
                                              "allowUnknownUsers", bAllowUnknownUsers,
                                              "checkPassword", bCheckPassword,
                                              "allowDisabledUsers", bAllowDisabledUsers));

      // Allow the ULC UX
      mapping permission = makeMapping("allowUnknownUsers", TRUE, "allowDisabledUsers", TRUE);
      if ( !highSecurity )
      {
        httpSetPermission("/UI_LoadBalance", permission);
        httpSetPermission("/UI_WebSocket",   permission);
      }
      else
      {
        httpSetPermission("/UI_WebSocket",   allowAll);

        // /UI_LoadBalance is used to get the user for ULC UX, so "authType" must not be
        // set to "" as for other URLs.
        permission.insert("allowUsers", "*");
        httpSetPermission("/UI_LoadBalance", permission);
      }
    }
    else if ( highSecurity )
    {
      httpSetPermission("/_info",          allowAll);
      httpSetPermission("/UI_WebSocket",   allowAll);

      // /UI_LoadBalance is used to get the user for ULC UX, so "authType" must not be
      // set to "" as for other URLs.
      httpSetPermission("/UI_LoadBalance", makeMapping("allowUsers", "*",
                                                       "allowUnknownUsers", true,
                                                       "allowDisabledUsers", true));
    }

    httpConnect("workInfo", "/_info", "text/plain");

    if (securityLevel < HttpServerSecurityLevel::HIGH)
    {
      // get information if indexPage is set in Config
      string indexPage;
      if ( paCfgReadValue(CONFIG_FILE, "httpServer", "indexPage", indexPage) == -1 )
        httpConnect("redirectToDownload", "/");

      httpConnect("getIndex", "/download");

      // connect endpoints for Dashboard/WebUI
      WebUiHttpEndpoints::connectEndpoints(httpsPort, httpAuth);

      // connect endpoints for PM Add-ons / PM-AGENT
      PmAgentHttpEndpoints::connectEndpoints(httpsPort);

      // IOT Suite Reporting
      RptHttpEndpoints::connectEndpoints(httpsPort);

      // OIDC specific endpoints
      OidcHttpEndpoints::connectEndpoints(allowAll);

      // connect endpoints for Marketplace
      MarketplaceEndpoints::connectEndpoints(httpsPort);

      // WebUI etc.
      httpSetPermission("/data/iot-suite/*",    allowAll);
      httpSetPermission("/data/dashboard/*",    allowAll);
      httpSetPermission("/data/dashboard-wc/*", allowAll);
      httpSetPermission("/data/WebUI/*",        allowAll);

      // token provider service
      WebUiTokenProviderService::startService();

      // for security reasons, the config directory can not be accessed directly
      httpConnect("getConfig",          "/config/config",          "text/plain");
      httpConnect("getStyleSheet",      "/config/stylesheet.css",  "text/plain");
      httpConnect("getTouchStyleSheet", "/config/touchscreen.css", "text/plain");
      if (securityLevel == HttpServerSecurityLevel::DEFAULT)
      {
        httpConnect("getHostCert",      "/config/host-cert.pem",   "text/plain");
        httpConnect("getHostKey",       "/config/host-key.pem",    "text/plain");
        httpConnect("getRootCert",      "/config/root-cert.pem",   "text/plain");
      }
      httpConnect("getPowerConfig",     "/config/powerconfig",     "text/plain");
      httpConnect("logFileUpload",      "/logFileUpload",          "text/plain");

      // exclude specific driver directories, which contain sensitive information
      httpSetPermission("/data/bacnet/cert/*",                 DENY_ALL);
      httpSetPermission("/data/mqtt/cert/*",                   DENY_ALL);
      httpSetPermission("/data/s7plus/cert/*",                 DENY_ALL);
      httpSetPermission("/data/IEC61850/cert/*",               DENY_ALL);
      httpSetPermission("/data/iec104/PKI/private/*",          DENY_ALL);
      httpSetPermission("/data/opcua/*/PKI/CA/private/*",      DENY_ALL);
      httpSetPermission("/data/opcua/*/PKI/own/private/*",     DENY_ALL);
    }

    dpQueryConnectSingle("cbConnectUI", TRUE, "connect", "SELECT '_online.._value' FROM '_Ui_*.DisplayName' WHERE _DPT= \"_Ui\" AND '_online.._value' != \"\" ");
    dpQueryConnectSingle("cbDisconnectUI", FALSE, "disconnect", "SELECT '_online.._value' FROM '_Ui_*.DisplayName' WHERE _DPT= \"_Ui\" AND '_online.._value' == \"\" ");

    return 0;
  }

  //--------------------------------------------------------------------------------
  // protected methods

  /// return answer in a httpConnect() callback when requested resource was not found
  protected static dyn_string notFoundAnswer()
  {
    return makeDynString(NOT_FOUND, "Status: 404 Not Found");
  }

  //--------------------------------------------------------------------------------

  /// return answer for a bad request
  protected static dyn_string badRequestAnswer()
  {
    return makeDynString("", "Status: 400 Bad Request");
  }

  //--------------------------------------------------------------------------------
  // private methods

  protected static dyn_string authInfo(dyn_string names, dyn_string values, string user)
  {
    mapping data = makeMapping("needAuth", ulcNeedAuth, "user",  user, "uid", getUserId(user));

    mapping oidcConfig = getAuthConfig();
    if (oidcConfig["authType"] == "OIDC") // modern authentication?
    {
      dyn_string attrNames = makeDynString("authType", "realm", "endpointList",
        "endpointCertificates", "clientId", "redirectHost", "redirectEndpoint",
        "tokenCookieName", "tokenCookieAttributes");

      for ( int i = 1; i <= dynlen(attrNames); i++ )
        data.insert(attrNames[i], oidcConfig[attrNames[i]]);
    }

    return jsonEncode(data);
  }

  //--------------------------------------------------------------------------------

  static string getArchFile(string cliArch)
  {
    string dir = "/data/clsetup/" + cliArch + "/";
    // to match WinCC_OA_ or WinCCOA- or ...
    string filter = "WinCC*OA*" + VERSION + "*";

    dyn_string files = getFileNames(PVSS_PATH + dir, filter);

    if ( dynlen(files) == 0 )
    {
      DebugFTN("HTTP", "no valid patch package found in " + dir + filter + " installPath=" + PVSS_PATH);
      return "";
    }

    return dir + files[1];
  }

  //--------------------------------------------------------------------------------

  static string getMostRecentFile(const string &dir, const string &pattern)
  {
    dyn_string files = getFileNames(dir, pattern);

    // handle simple cases first
    if ( dynlen(files) == 0 )
      return "";
    else if ( dynlen(files) == 1)
      return files[1];

    // now lookup most recent
    string name;
    time newestTs;
    for (int i = 1; i <= dynlen(files); i++)
    {
      time ts = getFileModificationTime(dir + files[i]);
      if ( ts > newestTs )
      {
        name = files[i];
        newestTs = ts;
      }
    }

    return name;
  }

  //--------------------------------------------------------------------------------

  static dyn_string handleUlcLogin(const dyn_string names, const dyn_string values, const string user)
  {
    string filePath = getPath(DATA_REL_PATH, "html/login/index.html");

    if ( filePath != "" )
    {
      mapping lang;
      mapping json;
      string content;

      fileToString(filePath, content);

      dyn_string langStrings = makeDynString("login", "usernameEmptyText","passwordEmptyText","welcomeText","cancel", "invalidCreditentials");
      for (int i = 1; i <= dynlen(langStrings); i++) {
          lang[langStrings[i]] = getCatStr("http", langStrings[i]);
       }
      json["lang"] = lang;

      int thisMajor = getVersionInfo("major"), thisMinor = getVersionInfo("minor"), thisPatch = getVersionInfo("patch"), thisRevision = getVersionInfo("revision");
      json["productVersion"] = thisMajor + "." + thisMinor + " P" + thisPatch + " Rev." + thisRevision;

      strreplace(content, "{DATA}", jsonEncode(json));

      return makeDynString(content, "Status: 200 OK");
    }

    // return not found (should not happen)
    return notFoundAnswer();
  }

  //--------------------------------------------------------------------------------

  static dyn_string ulcConfig()
  {
    const string SECTION = "ulcUX";

    // settings are cached at the first call, only read settings if cached
    // settings are empty
    if ( ulcConfigJson.isEmpty() )
    {
      mapping result;

      // Get [ulc] setting(s) from all config files, always use the setting with
      // highest priority (project, then sub-projects, then installation)
      for (int i = 1; i <= SEARCH_PATH_LEN; i++)
      {
        string path = getPath(CONFIG_REL_PATH, "config", -1, i);
        if ( !path.isEmpty() )
        {
          int reconnectCount;
          if ( paCfgReadValue(path, SECTION, "reconnectCount", reconnectCount) == 0 )
          {
            result.insert("reconnectCount", (reconnectCount < 0) ? -1 : reconnectCount);
            break; // currently only one setting is returned => finished
          }
        }
      }

      ulcConfigJson = jsonEncode(result);
    }

    // return (possibly empty) result
    return makeDynString(ulcConfigJson, "Status: 200 OK");
  }

  //--------------------------------------------------------------------------------

  static dyn_string redirectToDownload()
  {
    return makeDynString("", "Status: 301 Moved Permanently", "Location: /download");
  }

  //--------------------------------------------------------------------------------

  protected static dyn_string getIndex(dyn_string names, dyn_string values, string user, string ip,
                                       dyn_string headerNames, dyn_string headerValues)
  {
    string filePath = getPath(DATA_REL_PATH, "webclient_index.html");
    if ( filePath == "" )  // does not exist
      return notFoundAnswer();

    string content;
    fileToString(filePath, content);


    return makeDynString(content, "Status: 200 OK");
  }

  //--------------------------------------------------------------------------------

  static anytype workInfoClientUpdateCheck(const dyn_string &names, const dyn_string &values,
                                           const string &user, const string &ip,
                                           const dyn_string &headerNames, const dyn_string &headerValues,
                                           int connIdx, int cliLang = -1)
  {
    if ( dynlen(names) < 5 ||
         dynContains(names, "major") <= 0 ||
         dynContains(names, "minor") <= 0 ||
         dynContains(names, "patch") <= 0 ||
         dynContains(names, "arch") <= 0 )
      return badRequestAnswer();

    //TODO: check if strings are really numerics
    string cliMajor = values[dynContains(names, "major")];
    string cliMinor = values[dynContains(names, "minor")];
    string cliPatch = values[dynContains(names, "patch")];
    string cliRevision = (dynContains(names, "revision") > 0) ? values[dynContains(names, "revision")] : "0";
    string cliArch = values[dynContains(names, "arch")];

    if (cliLang < 0)
      cliLang = httpGetLanguage(connIdx);

    int thisMajor = getVersionInfo("major"), thisMinor = getVersionInfo("minor"), thisPatch = getVersionInfo("patch"), thisRevision = getVersionInfo("revision");

    DebugFTN("HTTP", "Client", cliMajor, cliMinor, cliPatch, cliArch, cliRevision, cliLang);
    DebugFTN("HTTP", "Server", thisMajor, thisMinor, thisPatch, thisRevision);

    string content = "";
    mapping m = makeMapping("major", thisMajor,
                            "minor", thisMinor,
                            "patch", thisPatch,
                            "revision", thisRevision);

    if ((string)thisMajor == cliMajor &&
        (string)thisMinor == cliMinor)
    {
      DebugFTN("HTTP", "Version matches");

      if (thisPatch == ((int)cliPatch) && thisRevision <= ((int)cliRevision))
      {
        DebugFTN("HTTP", "Patchlevel matches and Revision is OK for connection");

        m["connect"] = "OK";
        content = jsonEncode(m);

        return makeDynString(content, "Status: 200 OK");
      }
      else
      {
        if (thisPatch < ((int)cliPatch))
        {
          DebugFTN("HTTP", "Patchlevel is OK for connection");

          m["connect"] = "OK";
          content = jsonEncode(m);

          return makeDynString(content, "Status: 200 OK");
        }
        else
        {
          DebugFTN("HTTP", "newer patch and/or revision available.");
          // return new patch
          if (cliArch == "windows-64")
          {
            m["patchURL"] = "/data/clsetup/windows-64/WinCC_OA_Desktop_UI_" + VERSION + "_x64.exe";
          }
          else if (cliArch == "windows")
          {
            m["patchURL"] = "/data/clsetup/windows/WinCC_OA_Desktop_UI_" + VERSION + ".exe";
          }
          else
          {
            string fn = getArchFile(cliArch);

            if ( fn == "" )
            {
              m["infoText"] = getCatStr("http", "rtUiOutdatedNoNewer", cliLang);
              m["connect"] = "OK";
              m["patchURL"] = "/";
              content = jsonEncode(m);
              return makeDynString(content, "Status: 200 OK");
            }

            m["patchURL"] = fn;
          }

          DebugFTN("HTTP", "Found patch for architecture", m["patchURL"]);

          m["infoText"] = getCatStr("http", "rtUiOutdatedNewer", cliLang);
          m["connect"] = "OK";
          content = jsonEncode(m);
          return makeDynString(content, "Status: 200 OK");
        }
      }
    }
    else
    {
      DebugFTN("HTTP", "Version does not match server");
      m["infoText"] = getCatStr("http", "rtUiNoMatch", cliLang);
      m["connect"] = "NOK";
      m["patchURL"] = "/";

      content = jsonEncode(m);
      return makeDynString(content, "Status: 200 OK");

    }

    return badRequestAnswer();
  }

  //--------------------------------------------------------------------------------
  // Only used anymore for ITCv3

  // E.g. request from ui_webruntime.sh from ITC: /_info?uiWebRuntimeVersion=WinCC_OA_3.19-ui-webruntime-1-2.i686&type=tgz&sub=itcv3
  //   1 = Patch, 2 = Revision = optional

  static anytype workInfoUiWebRuntimeVersion(const dyn_string &names, const dyn_string &values)
  {
    int thisMajor = getVersionInfo("major"), thisMinor = getVersionInfo("minor"), thisPatch = getVersionInfo("patch"), thisRevision = getVersionInfo("revision");
    string arch = "*";    // architecture
    string type = "rpm";  // package type

    string current = values[1];  // currently installed version on client (or empty)
    int currentMajor = 0, currentMinor = 0;
    int currentServicePack = 0, currentPatchNum = 0, currentRevisionNum = 0;

    int i = strpos(current, "ui-webruntime");
    if ( i >= 0 )
    {
      if ( sscanf(current, "WinCC_OA_%d.%d-ui-webruntime-%d-%d.%d.%s",
                  currentMajor, currentMinor, currentServicePack,
                  currentPatchNum, currentRevisionNum, arch) != 6 )
      {
        sscanf(current, "WinCC_OA_%d.%d-ui-webruntime-%d-%d.%s",
               currentMajor, currentMinor, currentServicePack,
               currentPatchNum, arch);
      }
    }
    else
    {
      // check for requested architecture if no rpm is already installed
      int idx = dynContains(names, "arch");
      if ( idx >= 1 )
        arch = values[idx];
    }
    DebugFN("HTTP", "workInfoUiWebRuntimeVersion: current: "+current+" => major="+currentMajor+", minor="+currentMinor+", servicePack="+currentServicePack+", patchNum="+currentPatchNum+", revisionNum="+currentRevisionNum+", arch="+arch);

    string sub = "itcv3";  // special variation of uiWebRuntime, e.g. for ITC
    int idx = dynContains(names, "sub");
    if ( idx >= 1 )
      sub = values[idx];

    idx = dynContains(names, "type");  // package type
    if ( idx >= 1 )
      type = values[idx];

    string fileName = getArchFile(sub);
    DebugFN("HTTP", "workInfoUiWebRuntimeVersion: fileName="+fileName+", sub="+sub);
    if ( fileName == "" )
      return "";

    // create sortable strings, e.g. "Ver_SP_PPP"
    string myVersion, clVersion;
    sprintf(myVersion, "%02d%02d_%02d_%03d_%03d", thisMajor, thisMinor, 0, thisPatch, thisRevision);
    sprintf(clVersion, "%02d%02d_%02d_%03d_%03d", currentMajor, currentMinor, currentServicePack, currentPatchNum, currentRevisionNum);
    DebugFN("HTTP", "myVersion", myVersion, "clientVersion", clVersion);

    if ( myVersion > clVersion )
    {
      DebugFN("HTTP", "newer version found => return "+fileName);
      return fileName;
    }

    DebugFN("HTTP", "no newer version found");
    return "";   // nothing to download
  }

  //--------------------------------------------------------------------------------

  static anytype workInfoUuid(const dyn_string &names, const dyn_string &values,
                              const string &user, const string &ip,
                              const dyn_string &headerNames, const dyn_string &headerValues,
                              int connIdx, int cliLang = -1)
  {
    // regular expressions to verify UUID and version
    const string UUID_REGEXP = "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$";
    const string VERSION_REGEXP = "^[3-9]\\.[1-9][0-9]*$";

    // in addition to some plausibility checks, make sure that all value names
    // that are sent by FileCache::init() are actually included in this request.
    const dyn_string EXPECTED_VALUE_NAMES = makeDynString("uuid", "model", "name", "w", "h", "dpi");
    for (int i = 1; i <= EXPECTED_VALUE_NAMES.count(); i++)
      if ( dynContains(names, EXPECTED_VALUE_NAMES[i]) <= 0 )
        return badRequestAnswer();

    // get Data - UUID
    string uuid = values[dynContains(names, "uuid")];

    if ( regexpIndex(UUID_REGEXP, uuid) != 0 )
      return badRequestAnswer();

    // get Data - Model
    string model = values[dynContains(names, "model")];

    //TFS 15236: ULC UX shall not be handled at all by device management
    if ( model == "ulc" )
      return "";

    // get Data - Name, Width, Heigth and DPI
    string sname = values[dynContains(names, "name")];
    int w = (int)values[dynContains(names, "w")];
    int h = (int)values[dynContains(names, "h")];
    int dpi = (int)values[dynContains(names, "dpi")];

    int idx = dynContains(headerNames, "user-agent");
    string appVersion;

    // App Version from user-agent header
    if ( idx >= 1 )
    {
      dyn_string dsTemp = strsplit(headerValues[idx], " ");

      if ( (dsTemp.count() > 3) && (dsTemp[1] == "WinCC_OA") && (dsTemp[2] == "Ui") &&
           (regexpIndex(VERSION_REGEXP, dsTemp[3]) == 0) )
      {
        appVersion = dsTemp[3];
      }
      else
      {
        return badRequestAnswer();
      }
    }
    else
    {
      return badRequestAnswer();
    }

    if (cliLang < 0)
      cliLang = httpGetLanguage(connIdx);

    // .... check uuid
    dyn_string dpDeviceNames, dsUUID, dsDeviceClass;
    dyn_bool dbunlocked, dbAutoLogin;
    dyn_int diManagerNum;
    mapping data;

    //Get Device Data from Datapoint
    dpGet(MOBILE_UI_PRAEFIX_DP + ".DisplayName", dpDeviceNames,
          MOBILE_UI_PRAEFIX_DP + ".UUID", dsUUID,
          MOBILE_UI_PRAEFIX_DP + ".DeviceClass", dsDeviceClass,
          MOBILE_UI_PRAEFIX_DP + ".AutoLogin", dbAutoLogin,
          MOBILE_UI_PRAEFIX_DP + ".Unlocked", dbunlocked,
          MOBILE_UI_PRAEFIX_DP + ".ManagerNumber", diManagerNum);

    int iDynIndex = dynContains(dsUUID, uuid);

    //Case: UUID does not exist
    if (iDynIndex < 1)
    {
      //create datapoint with UUID and model
      dyn_string dsDeviceClasses;
      string sDeviceClass = "";
      dyn_int diHeight, diWidth;
      bool bMobileAutoUnlock, bRuntimeAutoUnlock;

      // define device class for mobile Ui
      if ( model != "desktop" )
      {
        if ( dpi > 0 )  // screen diagonal in Inches
        {
          float deviceDiagonal = sqrt((w / dpi) * (w / dpi) + (h / dpi) * (h / dpi));
          sDeviceClass = (deviceDiagonal > MAX_SMARTPHONE_SCREEN) ? "tablet" : "smartphone";
        }
        else
        {
          sDeviceClass = "smartphone";
        }
      }

      //create Mapping
      data["arguments"] = "";
      data["deviceClass"] = sDeviceClass;
      data["deviceLocked"] = TRUE;

      int iManNum = 0;
      if (model != "desktop")
      {
        // Find a new fixed UI manager number if not a Desktop UI has connected
        for (int i = lowestAutoManNumMobileUI; iManNum == 0 && i < 255; i++)
        {
          if (dynContains(diManagerNum, i) == 0)
            iManNum = i;
        }

        if (iManNum == 0)
        {
          throwError(makeError("", PRIO_SEVERE, ERR_PARAM, (int)ErrCode::UNEXPECTEDSTATE,
                               getCatStr("http", "noManNumError", cliLang), sname, model));

          // return the error to the mobile UI
          data["deviceLocked"] = TRUE;
          data["reason"] = "noManNum";

          data["infoText"] = getCatStr("http", "noManNumInfo", cliLang);
          data["titleText"] = getCatStr("http", "noManNumTitle", cliLang);
          return jsonEncode(data);
        }
      }

      dpGet(MOBILE_UI_PRAEFIX_DP_2 + ".AutoValidationEnabled", bMobileAutoUnlock,
            MOBILE_UI_PRAEFIX_DP_2 + ".AutoRuntimeValidationEnabled", bRuntimeAutoUnlock,
            MOBILE_UI_PRAEFIX_DP_2 + ".Name", dsDeviceClasses,
            MOBILE_UI_PRAEFIX_DP_2 + ".Resolution.Width", diHeight,
            MOBILE_UI_PRAEFIX_DP_2 + ".Resolution.Height", diWidth);

      //Case: AutoUnlock is enabled
      if ( (bMobileAutoUnlock && model != "desktop") || (bRuntimeAutoUnlock && model == "desktop") )
      {
        data["deviceLocked"] = FALSE;

        if (model != "desktop")
        {
          data["arguments"] = "-num " + iManNum;

          if (dpExists("_Ui_" + iManNum) == FALSE)
          {
            int iRet;

            iRet = dpCreate("_Ui_" + iManNum, "_Ui");

            if (dynlen(getLastError()) > 0 || iRet)
            {
              throwError(makeError("", PRIO_SEVERE, ERR_SYSTEM, (int)ErrCode::UNEXPECTEDSTATE,
                                   "Could not perform auto unlock, because internal datapoint: _Ui_" + iManNum + " could not be created"));

              data["deviceLocked"] = TRUE;
            }
            else
              dpSet("_Ui_" + iManNum + ".UserName:_archive.._type", DPCONFIG_DEFAULTVALUE,
                    "_Ui_" + iManNum + ".UserName:_archive.._archive", TRUE);
          }
        }
      }

      // define DP elements
      dyn_string dsDpe = makeDynString(MOBILE_UI_PRAEFIX_DP + ".DisplayName",
                                       MOBILE_UI_PRAEFIX_DP + ".UUID",
                                       MOBILE_UI_PRAEFIX_DP + ".ProductModel",
                                       MOBILE_UI_PRAEFIX_DP + ".ManagerNumber",
                                       MOBILE_UI_PRAEFIX_DP + ".DeviceClass",
                                       MOBILE_UI_PRAEFIX_DP + ".Unlocked",
                                       MOBILE_UI_PRAEFIX_DP + ".AutoLogin",
                                       MOBILE_UI_PRAEFIX_DP + ".AppVersion");

      // define values for the DP elements
      dyn_anytype daValues = makeDynAnytype(sname,
                                            uuid,
                                            model,
                                            iManNum,
                                            sDeviceClass, // Deviceclass Vorschlag aufgrund der Hoehe und Breite
                                            !data["deviceLocked"],
                                            FALSE,
                                            appVersion);

      dpDynAppend(dsDpe, daValues);

      dpSet(MOBILE_UI_PRAEFIX_DP_2 + ".NewDevice", TRUE);
    }
    else
    {
      //Case: UUID already exists

      //Update App Version
      dyn_string dsDpe = makeDynString(MOBILE_UI_PRAEFIX_DP + ".AppVersion");
      dyn_anytype daValues = makeDynAnytype(appVersion);
      dpDynIdxSet(iDynIndex, dsDpe, daValues);

      //create Mapping - arguments, deviceclass, locked, rootpanel
      if (model != "desktop")
        data["arguments"] = "-num " + diManagerNum[iDynIndex];

      data["deviceClass"] = dsDeviceClass[iDynIndex];
      data["deviceLocked"] = !dbunlocked[iDynIndex];
    }

    return jsonEncode(data);
  }

  //--------------------------------------------------------------------------------

  static anytype workInfoSessionToken(const dyn_string &names, const dyn_string &values,
                                      const string &user, const string &ip,
                                      const dyn_string &headerNames, const dyn_string &headerValues,
                                      int connIdx)
  {
    // Default return value is an empty session token
    string type = values[1];
    mapping data = makeMapping("sessionToken", "");
    string host = getHeader("host", headerNames, headerValues);

    if ( isServerSideLoginEnabled )
    {
      // Do not allow server side authentication over an unsecure connection
      if ( httpGetPort(connIdx) != httpsPort )
      {
        throwError(makeError("", PRIO_SEVERE, ERR_PARAM, (int)ErrCode::UNEXPECTEDSTATE, "Server Side Authentication requires HTTPS"));

        anytype any;
        return any;
      }

      dyn_string error;
      OaAuthServerside auth;

      //if since last login the authentication method has changed the variable needs a new instance of an authServerside object
      if ( auth.getAuthType() != authServerSide.getAuthType() )
      {
        authServerSide = auth;
      }

      data = authServerSide.workInfoSessionToken(user, headerNames, headerValues, type, error);

      if (dynlen(error) > 0)
      {
        return error;
      }
    }

    return jsonEncode(data);
  }

  //--------------------------------------------------------------------------------

  static anytype workInfoClSetup(const dyn_string &names, const dyn_string &values,
                                 const string &user, const string &ip,
                                 const dyn_string &headerNames, const dyn_string &headerValues,
                                 int connIdx)
  {
    const string BASE_URL = "/data/clsetup/";
    string VERSION_FULL = VERSION + "." + getVersionInfo("patch");
    if (getVersionInfo("revision") > 0)
      VERSION_FULL += "." + getVersionInfo("revision");

    dyn_mapping data;

    // get the required OS, if empty, installers for all OSes are included.
    string os = values.isEmpty() ? "" : values.first();

    if (os.isEmpty() || (os == "windows"))
    {
      // Desktop UI installer for Windows
      string winFileName = "WinCC_OA_" + VERSION_FULL + "_DesktopUI_x64.exe";
      data.append(makeMapping("package",  "Desktop UI",
                              "platform", "Windows 64-bit",
                              "file",     BASE_URL + winFileName));
      data.append(makeMapping("package",  "Desktop UI",
                              "platform", "Windows 64-bit",
                              "file",     BASE_URL + "windows-64/" + winFileName));
    }

    if (os.isEmpty() || (os == "linux"))
    {
      const string BASE_DIR =  getPath("", BASE_URL, SEARCH_PATH_LEN);

      // Desktop UI and CodeMeter installers for Linux
      string linuxFileName = "WinCCOA-" + VERSION_FULL + "-DesktopUI-debian.x86_64.zip";
      data.append(makeMapping("package",  "Desktop UI and CodeMeter",
                              "platform", "Debian x86-64",
                              "file",     BASE_URL + linuxFileName));
      data.append(makeMapping("package",  "Desktop UI and CodeMeter",
                              "platform", "Debian x86-64",
                              "file",     BASE_URL + "linux-debian-x86_64/" + linuxFileName));

      linuxFileName = "WinCCOA-" + VERSION_FULL + "-DesktopUI-rhel.x86_64.zip";
      data.append(makeMapping("package",  "Desktop UI and CodeMeter",
                              "platform", "RHEL/CentOS x86-64",
                              "file",     BASE_URL + linuxFileName));
      data.append(makeMapping("package",  "Desktop UI and CodeMeter",
                              "platform", "RHEL/CentOS x86-64",
                              "file",     BASE_URL + "linux-rhel-x86_64/" + linuxFileName));
    }

    // remove missing installers form the result
    for (int i = data.count(); i >= 1; i--)
    {
      string name = getPath("", data[i]["file"]);
      if (name.isEmpty() || !isfile(name))
        data.removeAt(i - 1); // 0-based
      else if ((i < data.count()) &&
               (data[i]["package"] == data[i + 1]["package"]) && (data[i]["platform"] == data[i + 1]["platform"]))
        data.removeAt(i - 1); // don't show duplicated package
    }

    if (data.isEmpty())
    {
      string version = VERSION;
      version.replace(".", "");
      return jsonEncode(makeMapping("download-link", "https://www.winccoa.com/downloads/category/wincc-oa-" + version + ".html"), false);
    }

    return jsonEncode(makeMapping("files", data), false);
  }

  //--------------------------------------------------------------------------------
  // return some information about the project

  protected static anytype workInfo(const dyn_string &names, const dyn_string &values,
                                    const string &user, const string &ip,
                                    const dyn_string &headerNames, const dyn_string &headerValues,
                                    int connIdx, int cliLang = -1)
  {
    if ( dynlen(names) == 0 )
      return badRequestAnswer();

    if ( names[1] == "projectName" )
    {
      string displayName;
      paCfgReadValue(getPath(CONFIG_REL_PATH) + "config", "general", "displayName", displayName);
      if ( displayName != "" )
        return displayName;
      else
        return PROJ + projectExtension;
    }

    if ( names[1] == "wccoaVersion" )
      return VERSION;

    if ( names[1] == "serverTime" )
      return formatTimeUTC(values[1], getCurrentTime());

    if ( names[1] == "clientUpdateCheck" )
      return workInfoClientUpdateCheck(names, values, user, ip, headerNames, headerValues, connIdx, cliLang);

    if ( names[1] == "uiWebRuntimeVersion" )
      return workInfoUiWebRuntimeVersion(names, values);

    if ( names[1] == "uuid" )
      return workInfoUuid(names, values, user, ip, headerNames, headerValues, connIdx, cliLang);

    if ( names[1] == "sessionToken" )
      return workInfoSessionToken(names, values, user, ip, headerNames, headerValues, connIdx);

    // everything below is only needed when there are external clients like Mobile/Desktop UI
    // so return NOT FOUND if security level blocks this
    if ( securityLevel == HttpServerSecurityLevel::HIGH )
      return notFoundAnswer();

    if ( names[1] == "clSetup" )
      return workInfoClSetup(names, values, user, ip, headerNames, headerValues, connIdx);

    // let the FileCache know for which directories alternative paths are supported
    if ( names[1] == "fileCacheSupport" )
      return jsonEncode(makeMapping("alternativePaths", makeDynString("/panels/", "/scripts/")));

    // retrieve a list of files /*and their last modified timestamp*/ (in XML format)
    // merged from all proj_paths

    // parameter 1: directory for recursive search or "|" separated list of directories for non recursively search
    // optional parameter 2: project names for searchleves to include; by default all search levels are included
    if ( names[1] == "listFiles" )
    {
      dyn_string files;
      if (!accessAllowed(values[1]))
        return getCatStr("http", "00010");

      DebugFTN(STDDBG_FILEOP, "WEBCLIENT", "names", names, "values", values);

      dyn_string dsDirectories = stringToDynString(values[1]);
      dyn_string dsSearchLevelFilter;

      if (dynlen(values) >= 2) // search only in special levels
        dsSearchLevelFilter = stringToDynString(values[2]);

      // INFO: Pattern match is done here in order to keep this "listFiles" feature generic
      files = getFileNamesLocal(dsDirectories, "*", dsSearchLevelFilter);
      files.unique();

      int doc = xmlNewDocument();
      int root = xmlAppendChild(doc, -1, XML_ELEMENT_NODE, "fileList");

      for (int i = 1; i <= dynlen(files); i++)
      {
        if ( baseName(files[i])[0] == '.' )
          continue;  // hidden file, e.g. .colorDB.lock

        int node = xmlAppendChild(doc, root, XML_ELEMENT_NODE, "file");
        xmlSetElementAttribute(doc, node, "name", files[i]);

        // get the absolute file path
        string sAbsFilePath = getAbsoluteFilePath(files[i], dsSearchLevelFilter);

        // get the modification time
        time tModi = (time)0L;
        if (sAbsFilePath != "")
        {
          tModi = getFileModificationTime(sAbsFilePath);
        }

        // send modification time to speed up init
        xmlSetElementAttribute(doc, node, "lastModified", formatTimeUTC("HTTP", tModi));
      }

      string strDoc = xmlDocumentToString(doc);
      xmlCloseDocument(doc);  // free memory
      DebugFN("HTTP", strDoc);
      return strDoc;
    }

    if ( names[1] == "translationFiles" )
    {
      int doc = xmlNewDocument();
      int root = xmlAppendChild(doc, -1, XML_ELEMENT_NODE, "fileList");

      for (int level = 1; level <= SEARCH_PATH_LEN; level++)
      {
        string fileName = getTranslationFile(level);

        // only return languages in the current project
        for (int lang = 0; lang < getNoOfLangs(); lang++)
        {
          string qmFile = getPath(MSG_REL_PATH, fileName + ".qm", lang);
          if ( qmFile.length() )
          {
            qmFile = MSG_REL_PATH + getLocale(lang) + "/" + baseName(qmFile);
            int node = xmlAppendChild(doc, root, XML_ELEMENT_NODE, "file");
            xmlSetElementAttribute(doc, node, "name", qmFile);
          }
        }
      }

      string strDoc = xmlDocumentToString(doc);
      xmlCloseDocument(doc);  // free memory
      DebugFN("HTTP", strDoc);
      return strDoc;
    }

    return notFoundAnswer();
  }

  //--------------------------------------------------------------------------------
  // add the hosts defined in [general] data or event entry to the hosts list to be
  // used for the automatically generated mxProxy entry for the Desktop or Mobile UI

  static void processDataOrEventEntry(const dyn_string &dsEntry, dyn_string &dsHostsForProxy)
  {
    for (int i = 1; i <= dynlen(dsEntry); i++)
    {
      dyn_string dsReduPairs = strsplit(dsEntry[i], "$");
      for (int j = 1; j <= dynlen(dsReduPairs); j++)
      {
        dyn_string dsReduNet = strsplit(dsReduPairs[j], ",");
        for (int k = 1; k <= dynlen(dsReduNet); k++)
        {
          dyn_string host = strsplit(dsReduNet[k], ":");
          dynAppend(dsHostsForProxy, strtolower(host[1]));
        }
      }
    }
  }

  //--------------------------------------------------------------------------------
  // return the config file (a generated version containing already all config.* files,
  // e.g. config.level, config.<OS>, config.redu

  protected static dyn_string getConfig(dyn_string names, dyn_string values, string user, string ip,
                                        dyn_string headerNames, dyn_string headerValues)
  {
    // Check if there is a special config file for the webclient
    string filePath = getPath(CONFIG_REL_PATH, "config.webclient");

    if ( filePath == "" )  // no, use normal config file
      filePath = getPath(CONFIG_REL_PATH, "config");

    string tmpConfig = tmpnam();
    if ( !copyFile(filePath, tmpConfig) )
    {
      remove(tmpConfig);
      throwError(makeError("", PRIO_WARNING, ERR_SYSTEM, (int)ErrCode::UNEXPECTEDSTATE,
                           "Copying config-file " + filePath + " to temp-config-file " + tmpConfig + " not possible"));
      return makeDynString("", "Status: 500 Internal Server Error");  // Kopiervorgang ist schief gegangen
    }

    dyn_string dsProjPathes;
    paCfgReadValueList(tmpConfig, "general", "proj_path", dsProjPathes);
    for (int i = 1; i <= dynlen(dsProjPathes); i++)
      paCfgDeleteValue(tmpConfig, "general", "proj_path");

    // we need to store every host which is reachable via mxProxy
    // so we can send this information to the client
    dyn_string dsHostsForProxy;

    // we add event to the config to be transferred to client
    dyn_string dsEvents, dsEventHost;
    paCfgReadValueList(tmpConfig, "general", "event", dsEvents);
    paCfgReadValueList(tmpConfig, "general", "eventHost", dsEventHost);

    if (dynlen(dsEventHost) > 0)
    {
      for (int i = 1; i <= dynlen(dsEventHost); i++)
      {
        dyn_string host = strsplit(strtolower(dsEventHost[i]), "$");
        dynAppend(dsHostsForProxy, host);
      }
    }
    else
    {
      if (dynlen(dsEvents) > 0)
      {
        processDataOrEventEntry(dsEvents, dsHostsForProxy);
      }
      else
      {
        //we have only one event manager in this case (single system)
        dyn_string host = eventHost();
        string target = host[1] + ":" + eventPort();
        dynAppend(dsHostsForProxy, strtolower(host[1]));
        paCfgInsertValue(tmpConfig, "general", "event", target);
      }
    }

    // we add data to the config to be transferred to client
    dyn_string dsDatas, dsDataHost;
    paCfgReadValueList(tmpConfig, "general", "data", dsDatas);
    paCfgReadValueList(tmpConfig, "general", "dataHost", dsDataHost);

    if (dynlen(dsDataHost) > 0)
    {
      for (int i = 1; i <= dynlen(dsDataHost); i++)
      {
        dyn_string host = strsplit(strtolower(dsDataHost[i]), "$");
        dynAppend(dsHostsForProxy, host);
      }
    }
    else
    {
      if (dynlen(dsDatas) > 0)
      {
        processDataOrEventEntry(dsDatas, dsHostsForProxy);
      }
      else
      {
        //we have only one data manager in this case (single system)
        dyn_string host = dataHost();
        string target = host[1] + ":" + dataPort();
        dynAppend(dsHostsForProxy, strtolower(host[1]));
        paCfgInsertValue(tmpConfig, "general", "data", target);
      }
    }

    dynUnique(dsHostsForProxy);
    dyn_string dsCurMxProxy;
    paCfgReadValueList(tmpConfig, "general", "mxProxy", dsCurMxProxy);

    for (unsigned i = 1; i <= dsCurMxProxy.count(); i++)
      dsCurMxProxy[i] = strtolower(dsCurMxProxy[i]);

    dynUnique(dsCurMxProxy);

    if (dynlen(dsHostsForProxy) > 0 && !dynContains(dsCurMxProxy, "none"))
    {
      // find which host did the client call, it should also have a running mxProxy
      int hostIndex = 0;

      if ((hostIndex = dynContains(headerNames, "host")) > 0)
      {
        // get the hostname which was used to reach the http(s) endpoint
        dyn_string headerHost = strsplit(strtolower(headerValues[hostIndex]), ":");

        // only if host in the http header is completely unrelated to
        // data and event hosts, add the mxProxy entries
        dyn_string alreadyWrittenProxyEntries;

        for (int j = 1; dsCurMxProxy.count() >= j; j++)
        {
          dyn_string tmpProxyEntry = strsplit(dsCurMxProxy[j], ' ');
          if (dynlen(tmpProxyEntry) >= 1)
            alreadyWrittenProxyEntries.append(tmpProxyEntry[1]);
        }

        int proxyPort = paCfgReadValueDflt(tmpConfig, "proxy", "proxyPort", 5678);

        for (int i = 1; i <= dynlen(dsHostsForProxy); i++)
        {
          // if there is no manual configuration for this proxy add an automatic one
          if (!dynContains(alreadyWrittenProxyEntries, dsHostsForProxy[i]))
            paCfgInsertValue(tmpConfig, "general", "mxProxy", dsHostsForProxy[i] + " " + headerHost[1] + ":" + proxyPort + " cert");
        }
      }
    }

    string config;
    fileToString(tmpConfig, config);
    remove(tmpConfig);

    // from WinCC_OA install dir down to project dir
    dyn_string configFiles;
    dynAppend(configFiles, "config.level");

    // add the config.<OS> from the clients OS if possible
    int idx = dynContains(headerNames, "user-agent");
    if ( idx > 0 )
    {
      string os = strtolower(headerValues[idx]);
      if ( strpos(os, "linux") != -1 )
        dynAppend(configFiles, "config.linux");
      else if ( strpos(os, "windows") != -1 )
        dynAppend(configFiles, "config.nt");
      else if ( strpos(os, "sunos") != -1 )
        dynAppend(configFiles, "config.solaris");
    }

    if ( isRedundant() )
      dynAppend(configFiles, "config.redu");

    for (int i = SEARCH_PATH_LEN; i >= 1; i--)
    {
      for (int j = 1; j <= dynlen(configFiles); j++)
      {
        filePath = getPath(CONFIG_REL_PATH, configFiles[j], 0, i);
        if ( filePath != "" )
        {
          string content;
          fileToString(filePath, content);
          config += "\n## " + filePath + " ##\n";
          config += content;
        }
      }
    }

    return makeDynString(config, "Status: 200 OK");
  }

  //--------------------------------------------------------------------------------
  // read all stylesheet files from all proj-paths and return the merged contents

  static string getMergedStylesheets(const string &fileName)
  {
    string mergedContents;

    for (int i = SEARCH_PATH_LEN; i >= 1; i--)
    {
      string filePath = getPath(CONFIG_REL_PATH, fileName, 0, i);
      if ( filePath != "" )
      {
        string contents;
        fileToString(filePath, contents);
        mergedContents += "\n/* " + filePath + " */\n";
        mergedContents += contents;
      }
    }

    return mergedContents;
  }

  //--------------------------------------------------------------------------------
  // return the config/stylesheet.css file

  protected static dyn_string getStyleSheet()
  {
    string contents = getMergedStylesheets("stylesheet.css");

    if ( contents == "" )
      return notFoundAnswer();
    else
      return makeDynString(contents, "Status: 200 OK");
  }

  //--------------------------------------------------------------------------------
  // IM 119158: return the config/powerconfig

  protected static dyn_string getPowerConfig()
  {
    string contents;
    for (int i = 1; i <= SEARCH_PATH_LEN; i++) //search in Project first
    {
      string filePath = getPath(CONFIG_REL_PATH, "powerconfig", 0, i);
      if ( filePath != "" )
      {
        contents = "";
        bool ret;
        ret = fileToString(filePath, contents);
        if ( (ret != 0) && (contents != "") ) //jump out if a powerconfig file is found
          break;
      }
    }

    if ( contents == "" )
      return notFoundAnswer();
    else
      return makeDynString(contents, "Status: 200 OK");
  }

  //--------------------------------------------------------------------------------
  // upload the sent logfile from mobile app

  static void logFileUpload(blob content, string user, string ip, dyn_string headernames, dyn_string headervalues, int connIdx)
  {
    int index;
    index = dynContains(headernames, "x-uuid");
    if ( index > 0 )
    {
      // found UUID in header
      string uuid = headervalues[index];

      dyn_string dsUUID;
      dyn_bool dbUnlocked;
      dyn_int diManagerNumbers;
      dyn_string dsDisplayNames;
      dpGet(MOBILE_UI_PRAEFIX_DP + ".UUID", dsUUID,
            MOBILE_UI_PRAEFIX_DP + ".Unlocked", dbUnlocked,
            MOBILE_UI_PRAEFIX_DP + ".ManagerNumber", diManagerNumbers,
            MOBILE_UI_PRAEFIX_DP + ".DisplayName", dsDisplayNames);

      index = dynContains(dsUUID, uuid);
      if ( index > 0 )
      {
        // UUID exists
        if ( dbUnlocked[index] )
        {
          // OK - save logfiles
          string contentType = getHeader("content-type", headernames, headervalues);
          int pos = strpos(contentType, "boundary=");
          if (pos >= 0)
          {
            string boundary = substr(contentType, pos + 9);

            // Hochkomma (") am Beginn und Ende entfernen
            boundary = substr(boundary, 1);
            boundary = substr(boundary, 0, strlen(boundary) - 1);

            mapping result;
            string saveDir = "";
            if ( diManagerNumbers[index] == 0 )  // desktop --> ManNr. 0
              saveDir = PROJ_PATH + LOG_REL_PATH + "desktopUI_logs_ui" + dsDisplayNames[index] + "/";
            else
              saveDir = PROJ_PATH + LOG_REL_PATH + "mobileUI_logs_ui" + diManagerNumbers[index] + "/";

            if ( !saveDir.contains("..") )
            {
              mkdir(saveDir);
              httpSaveFilesFromUpload(content, boundary, saveDir, result);
            }
            else
            {
              throwError(makeError("", PRIO_WARNING, ERR_SYSTEM, (int)ErrCode::UNEXPECTEDSTATE,
                                   "Invalid device name - logfiles not accepted!"));
            }
          }
        }
        else
        {
          throwError(makeError("", PRIO_WARNING, ERR_SYSTEM, (int)ErrCode::UNEXPECTEDSTATE,
                               "Your device needs to be authorized - logfiles not accepted!"));
        }
      }
      else
      {
        throwError(makeError("", PRIO_WARNING, ERR_SYSTEM, (int)ErrCode::UNEXPECTEDSTATE,
                             "UUID does not exist - UUID invalid - logfiles not accepted!"));
      }
    }
  }

  //--------------------------------------------------------------------------------
  // return the config/touchscreen.css file

  protected static dyn_string getTouchStyleSheet()
  {
    string contents = getMergedStylesheets("touchscreen.css");

    if ( contents == "" )
      return notFoundAnswer();
    else
      return makeDynString(contents, "Status: 200 OK");
  }

  //--------------------------------------------------------------------------------
  // return the config/host-cert.pem file

  protected static dyn_string getHostCert(dyn_string names, dyn_string values, string user, string ip,
                                          dyn_string headerNames, dyn_string headerValues)
  {
    return getFile(names, values, user, ip, headerNames, headerValues, "host-cert.pem", CONFIG_REL_PATH);
  }

  //--------------------------------------------------------------------------------
  // return the config/host-key.pem file

  protected static dyn_string getHostKey(dyn_string names, dyn_string values, string user, string ip,
                                         dyn_string headerNames, dyn_string headerValues)
  {
    return getFile(names, values, user, ip, headerNames, headerValues, "host-key.pem", CONFIG_REL_PATH);
  }

  //--------------------------------------------------------------------------------
  // return the config/root-cert.pemfile

  protected static dyn_string getRootCert(dyn_string names, dyn_string values, string user, string ip,
                                          dyn_string headerNames, dyn_string headerValues)
  {
    return getFile(names, values, user, ip, headerNames, headerValues, "root-cert.pem", CONFIG_REL_PATH);
  }

  //--------------------------------------------------------------------------------
  // return the file content of fileName

  static dyn_string getFile(dyn_string names, dyn_string values, string user, string ip,
                            dyn_string headerNames, dyn_string headerValues,
                            string fileName, string subPath = "")
  {
    string filePath = getPath(subPath, fileName);
    if ( filePath == "" )  // does not exist
      return notFoundAnswer();

    time m = getFileModificationTime(filePath);

    int idx = dynContains(headerNames, "if-modified-since");
    if ( idx > 0 )
    {
      time t = httpParseDate(headerValues[idx]);

      // to be able to have the exact same file on the client as on the server,
      // compare times as equal
      if ( m == t )
        return makeDynString("", "Status: 304 Not Modified");
    }

    string config;
    fileToString(filePath, config);
    return makeDynString(config, "Status: 200 OK", "Last-Modified: " + formatTime("HTTP", m));
  }

  //--------------------------------------------------------------------------------

  static void cbConnectUI(anytype atUserData, dyn_dyn_anytype ddaQRes)
  {
    dyn_bool unlocked;
    dyn_string dsUUIDs;
    dpGet("_UiDevices.Unlocked", unlocked,
          "_UiDevices.UUID", dsUUIDs);

    for (int i = 2; i <= dynlen(ddaQRes); i++)
    {
      mapping mTemp = jsonDecode(ddaQRes[i][2]);
      if ( mappingHasKey(mTemp, "id") )
      {
        string uuid;
        int uiManNum;
        uuid = mTemp["id"];
        sscanf(dpSubStr(ddaQRes[i][1], DPSUB_DP), "_Ui_%d", uiManNum);

        if ( !mappingHasKey(mUiUuid, uiManNum) )
          mUiUuid[uiManNum] = uuid;

        int pos = dynContains(dsUUIDs, uuid);
        if ( pos > 0 )
        {
          if ( unlocked[pos] == FALSE )
          {
            int manId = convManIdToInt(UI_MAN, uiManNum);

            if ( isRedundant() )
              dpSet("_Managers.Exit", manId, "_Managers_2.Exit", manId);
            else
              dpSet("_Managers.Exit", manId);
          }
        }
      }
    }
  }

  //--------------------------------------------------------------------------------

  static void cbDisconnectUI(anytype atUserData, dyn_dyn_anytype ddaQRes)
  {
    for (int i = 2; i <= dynlen(ddaQRes); i++)
    {
      int uiManNum;
      sscanf(dpSubStr(ddaQRes[i][1], DPSUB_DP), "_Ui_%d", uiManNum);

      if ( mappingHasKey(mUiUuid, uiManNum) )
        mappingRemove(mUiUuid, uiManNum);
    }
  }

  //--------------------------------------------------------------------------------
  /**
    @author jhercher
    callback function handling UI Managers connecting and disconnecting
  */
  static void cbHandleUiConnections(string dp1, dyn_int connectedUIs1, string dp2, dyn_int connectedUIs2)
  {
    dynAppend(connectedUIs1, connectedUIs2);
    dynUnique(connectedUIs1);

    authServerSide.handleConnections(connectedUIs1);
  }

  //--------------------------------------------------------------------------------
  /**
    @author jhercher
    callback function handling Sessiontoken written to _System.Auth.SessionTokenInterface
    this callback function must only be executed by one webserver! This is especially true on a redu system where only
    the webclient from the active system must execute this or changes to the session tokens might be lost.
  */

  static void cbHandleSessionTokens(string dp, string token)
  {
    string prefix = token[0];
    token = substr(token, 1);

    authServerSide.handleSessionTokens(prefix, token);
  }

  //--------------------------------------------------------------------------------
  /**
    @author jhercher
    function parses infoList path to see if unallowed path traversal happens
    @param path: path to be parsed
    @return bool: if path contains .. indicating parentdirectory the function returns TRUE else FALSE
    */

  static bool accessAllowed(string path)
  {
    strreplace(path, "\\", "/");
    dyn_string pathTokens = stringToDynString(path, "/");
    int sum = 0;

    for (int i = 1; i <= dynlen(pathTokens); i++)
    {
      int len = strlen(pathTokens[i]);
      if (pathTokens[i] == "..")
      {
        sum--;
      }
      else if (len > 0 && pathTokens[i] != ".")
      {
        sum++;
      }
      if (sum < 0)
      {
        return FALSE;
      }
    }

    return TRUE;
  }

  //--------------------------------------------------------------------------------
  /**
    The function gets the absolute file path for the given relative file path.
    It searches the file in the project and subprojects.
    @param sRelFilePath string,  relative file path (relative to project directory level)
    @param dsProjNames dyn_string, default: [], filters the projects to be searched, similar to getFileNamesLocal()
    @returns string, absolute file path for the file, if file is not found ""
   */
  static string getAbsoluteFilePath(const string &sRelFilePath, dyn_string dsProjNames = makeDynString())
  {
    for (int level = 1; level <= SEARCH_PATH_LEN; ++level)
    {
      string sBaseProjPath = getPath("", "", -1, level);

      // dsProjNames filter only applies if at least one project name is given
      bool bFilterIncludesSubProj = (dsProjNames.count() == 0);

      for (uint j = 0; j < dsProjNames.count() && !bFilterIncludesSubProj; ++j)
      {
        if ( strpos(strtolower(sBaseProjPath), strtolower(dsProjNames.at(j))) > -1 )
        {
          bFilterIncludesSubProj = true; // stops the loop
        }
      }

      if ( bFilterIncludesSubProj )
      {
        // build absolute file path
        string sAbsFilePath = sBaseProjPath + sRelFilePath;

        if ( isfile(sAbsFilePath) ) // file exists
        {
          return sAbsFilePath;
        }
      }
    }

    // file not found
    return "";
  }

  //--------------------------------------------------------------------------------
  // find header value

  protected static string getHeader(const string &header, const dyn_string &headerNames, const dyn_string &headerValues)
  {
    int idx = headerNames.indexOf(header);
    return (idx >= 0) ? headerValues.at(idx) : "";
  }

  //--------------------------------------------------------------------------------

  protected static int httpPort, httpsPort;
  protected static HttpServerSecurityLevel securityLevel;
  protected static mixed httpAuth;
  protected static mapping mUiUuid;
  protected static mixed authServerSide;
  protected static bool isServerSideLoginEnabled;
  protected static bool ulcNeedAuth;
  protected static int lowestAutoManNumMobileUI;
  protected static string projectExtension;
  protected static string ulcConfigJson;

  static const mixed UNDEFD_AUTH;  // empty mixed
  static const string MOBILE_UI_PRAEFIX_DP = "_UiDevices";
  static const string MOBILE_UI_PRAEFIX_DP_2 = "_UiDeviceMgmt";
  static const string CONFIG_FILE = getPath(CONFIG_REL_PATH) + "config";

  static const string NOT_FOUND =
      "<html><head><title>Error</title></head>"
      "<body><h1>Not found</h1>"
      "The requested resource was not found</body></html>";

  static const mapping DENY_ALL = makeMapping("denyUsers", "*",
                                              "allowUnknownUsers", false,
                                              "allowDisabledUsers", false);
  static const mapping ALLOW_ALL = makeMapping("authType", "");
  static const mapping ALLOW_ALL_HIGH = makeMapping("authType", "",
                                                    "allowUsers", "*",
                                                    "allowUnknownUsers", true,
                                                    "allowDisabledUsers", true);

  static const float MAX_SMARTPHONE_SCREEN = 7.0;  // maximum screen diagonal for smartphone in Inches
};

//--------------------------------------------------------------------------------
