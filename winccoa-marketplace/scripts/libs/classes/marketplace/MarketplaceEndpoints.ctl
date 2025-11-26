// $License: NOLICENSE
//--------------------------------------------------------------------------------
/**
  @file $relPath
  @copyright $copyright
  @author z004m03d
*/

//--------------------------------------------------------------------------------
// Libraries used (#uses)
#uses "CtrlHTTP"
#uses "vRPC"
#uses "classes/MarketplaceClient"

//--------------------------------------------------------------------------------
// Variables and Constants

//--------------------------------------------------------------------------------
/**
*/
class MarketplaceEndpoints
{
//--------------------------------------------------------------------------------
//@public members
//--------------------------------------------------------------------------------

  public static void connectEndpoints(int httpsPort)
  {
    initMarketplaceClient();

    const string MARKETPLACE_URL_PREFIX = "/marketplace";

    httpConnect(listRepos, MARKETPLACE_URL_PREFIX + "/listRepos", "application/json");
    httpConnect(clone, MARKETPLACE_URL_PREFIX + "/clone", "application/json");
    httpConnect(pull, MARKETPLACE_URL_PREFIX + "/pull", "application/json");
    httpConnect(registerSubProjects, MARKETPLACE_URL_PREFIX + "/registerSubProjects", "application/json");
    httpConnect(unregisterSubProjects, MARKETPLACE_URL_PREFIX + "/unregisterSubProjects", "application/json");
    httpConnect(listSubProjects, MARKETPLACE_URL_PREFIX + "/listProjects", "application/json");
    httpConnect(getDefaultAddonPath, MARKETPLACE_URL_PREFIX + "/getDefaultAddonPath", "application/json");
    httpConnect(listLocalRepos, MARKETPLACE_URL_PREFIX + "/listLocalRepos", "application/json");
    httpConnect(remove, MARKETPLACE_URL_PREFIX + "/remove", "application/json");
    httpConnect(setPmonCredentials, MARKETPLACE_URL_PREFIX + "/setPmonCredentials", "application/json");
    httpConnect(pmonCredentialsAreSet, MARKETPLACE_URL_PREFIX + "/pmonCredentialsAreSet", "application/json");
    httpConnect(currentProject, MARKETPLACE_URL_PREFIX + "/currentProject", "application/json");
    httpOnConnectionClose(closeCB);
  }

  //--------------------------------------------------------------------------------
  public static dyn_string listRepos(const dyn_string &names, const dyn_string &values)
  {
    int idx = names.indexOf("organization");
    string organization = "winccoa";
    if (idx >= 0)
    {
      organization = values.at(idx);
    }
    try
    {
      string response = jsonEncode(client.listRepos(organization));
      return makeDynString(response, "Status: 200 OK");
    }
    catch
    {
      return makeDynString(jsonEncode(makeMapping("error", "Couldn't retrieve repositories for organization " + organization)), "Status: 500 Internal Server Error");
    }
  }


  //--------------------------------------------------------------------------------
  public static dyn_string clone(const dyn_string &names, const dyn_string &values)
  {
    int idx = names.indexOf("url");
    if (idx < 0)
    {
      return makeDynString("Missing required parameter: url", "Status: 400 Bad Request");
    }
    string url = values.at(idx);

    idx = names.indexOf("path");
    string path = "";
    if (idx >= 0) {
      path = values.at(idx);
    }

    try
    {
      mapping result = client.clone(url, path);
      result.insert("message", "Successfully cloned " + url + " into " + path);
      return makeDynString(jsonEncode(result), "Status: 200 OK");
    }
    catch
    {
      DebugTN("clone failed!", getLastException());
      return makeDynString(jsonEncode(makeMapping("error", "Couldn't clone repository " + url + " into " + path)), "Status: 500 Internal Server Error");
    }
  }


  //--------------------------------------------------------------------------------
  public static dyn_string pull(const dyn_string &names, const dyn_string &values)
  {
    int idx = names.indexOf("repoName");
    if (idx < 0)
    {
      return makeDynString("Missing required parameter: repoName", "Status: 400 Bad Request");
    }
    string repoName = values.at(idx);

    string session = "";
    idx = names.indexOf("session");
    if (idx >= 0)
    {
      session = values.at(idx);
    }

    try
    {
      mapping requestMapping;
      string path = joinPath(client.repoPath(), repoName);
      requestMapping.insert("repoPath", path);
      requestMapping.insert("session", session);
      mapping result = client.pull(requestMapping);
      result.insert("message", "Successfully pulled repository " + repoName);
      return makeDynString(jsonEncode(result), "Status: 200 OK");
    }
    catch
    {
      return makeDynString(jsonEncode(makeMapping("error", "Couldn't pull repository " + repoName)), "Status: 500 Internal Server Error");
    }
  }


  //--------------------------------------------------------------------------------
  public static dyn_string registerSubProjects(const dyn_string &names, const dyn_string &values)
  {
    int idx = names.indexOf("repoName");
    if (idx < 0)
    {
      return makeDynString("Missing required parameter: repoName", "Status: 400 Bad Request");
    }
    string repoName = values.at(idx);

    idx = names.indexOf("fileContent");
    if (idx < 0)
    {
      return makeDynString("Missing required parameter: fileContent", "Status: 400 Bad Request");
    }
    string fileContent = values.at(idx);

    string session = "";
    idx = names.indexOf("session");
    if (idx >= 0)
    {
      session = values.at(idx);
    }

    mapping requestMapping;
    string path = joinPath(client.repoPath(), repoName);
    requestMapping.insert("repositoryPath", path);
    requestMapping.insert("fileContent", fileContent);
    requestMapping.insert("session", session);

    bool success = client.registerSubProjects(requestMapping);

    if (success)
    {
      return makeDynString("Successfully registered subproject from " + path, "Status: 200 OK");
    }
    else
    {
      return makeDynString(jsonEncode(makeMapping("error", "Couldn't register subproject from " + repo)), "Status: 500 Internal Server Error");
    }
  }

  //--------------------------------------------------------------------------------
  public static dyn_string unregisterSubProjects(const dyn_string &names, const dyn_string &values)
  {
    int idx = names.indexOf("repoName");
    if (idx < 0)
    {
      return makeDynString("Missing required parameter: repoName", "Status: 400 Bad Request");
    }
    string repoName = values.at(idx);


    idx = names.indexOf("fileContent");
    if (idx < 0)
    {
      return makeDynString("Missing required parameter: fileContent", "Status: 400 Bad Request");
    }
    string fileContent = values.at(idx);

    bool deleteFiles = true;
    idx = names.indexOf("deleteFiles");
    if (idx >= 0)
    {
      deleteFiles = values.at(idx) == "true";
    }

    mapping requestMapping;
    string path = joinPath(client.repoPath(), repoName);
    requestMapping.insert("repositoryPath", path);
    requestMapping.insert("fileContent", fileContent);
    requestMapping.insert("deleteFiles", deleteFiles);

    bool success = client.unregisterSubProjects(requestMapping);

    if (success)
    {
      if (deleteFiles)
      {
        return makeDynString("Successfully unregistered and deleted subproject from " + path, "Status: 200 OK");
      }
      return makeDynString("Successfully unregistered subproject from " + path, "Status: 200 OK");
    }
    else
    {
      return makeDynString(jsonEncode(makeMapping("error", "Couldn't unregister subproject from " + path)), "Status: 500 Internal Server Error");
    }
  }

  //--------------------------------------------------------------------------------
  public static dyn_string listSubProjects()
  {
    dyn_string response = client.listSubProjects();
    if (dynlen(response) > 0)
    {
      return makeDynString(jsonEncode(response), "Status: 200 OK");
    }
    else
    {
      return makeDynString(jsonEncode(makeMapping("error", "No subproject registered")), "Status: 404 Not Found");
    }
  }

  //--------------------------------------------------------------------------------
  public static dyn_string getDefaultAddonPath()
  {
    string response = client.repoPath();
    if (response != "")
    {
      return makeDynString(jsonEncode(response), "Status: 200 OK");
    }
    else
    {
      return makeDynString(jsonEncode(makeMapping("error", "Could not find default addon path")), "Status: 404 Not Found");
    }
  }

  //--------------------------------------------------------------------------------
  public static dyn_string listLocalRepos()
  {
    string response = client.listLocalRepos();
    if (response != "")
    {
      return makeDynString(response, "Status: 200 OK");
    }
    else
    {
      return makeDynString(jsonEncode(makeMapping("error", "Could not find local repos")), "Status: 404 Not Found");
    }
  }

  //--------------------------------------------------------------------------------
  public static dyn_string remove(const dyn_string &names, const dyn_string &values)
  {
    int idx = names.indexOf("repoName");
    if (idx < 0)
    {
      return makeDynString("Missing required parameter: repoName", "Status: 400 Bad Request");
    }
    string repoName = values.at(idx);

    try
    {
      string path = joinPath(client.repoPath(), repoName);
      mapping result = client.remove(path);
      result.insert("message", "Successfully deleted repository " + repoName);
      return makeDynString(jsonEncode(result), "Status: 200 OK");
    }
    catch
    {
      return makeDynString(jsonEncode(makeMapping("error", "Couldn't delete repository " + repoName)), "Status: 500 Internal Server Error");
    }
  }

  //--------------------------------------------------------------------------------
  public static dyn_string setPmonCredentials(const blob &content, string user, string ip, dyn_string headerNames, dyn_string headerValues, int connectionIndex)
  {
    string jsonData;
    blobGetValue(content, 0, jsonData, bloblen(content));
    mapping contentMapping = jsonDecode(jsonData);

    if (!mappingHasKey(contentMapping, "user") || !mappingHasKey(contentMapping, "password"))
    {
      return makeDynString(jsonEncode(makeMapping("error", "Missing required data: user and/or password")), "Status: 400 Bad Request");
    }

    bool validCredentials = client.setPmonCredentials(connectionIndex, contentMapping["user"], contentMapping["password"]);

    if (validCredentials)
    {
      return makeDynString(jsonEncode("Credentials set"), "Status: 200 OK");
    }
    else
    {
      return makeDynString(jsonEncode(makeMapping("error", "Invalid user/password")), "Status: 401 Unauthorized");
    }
  }

  //--------------------------------------------------------------------------------
  public static dyn_string pmonCredentialsAreSet(const dyn_string &names, const dyn_string &values, const string user, string ip, dyn_string headerNames, dyn_string headerValues, int connectionIndex)
  {
    bool validCredentials = client.verifyPmonCredentials(connectionIndex);

    if (validCredentials)
    {
      return makeDynString(jsonEncode("Credentials are set"), "Status: 200 OK");
    }
    else
    {
      return makeDynString(jsonEncode(makeMapping("error", "No valid credentials set")), "Status: 401 Unauthorized");
    }
  }

  //--------------------------------------------------------------------------------
  public static dyn_string currentProject()
  {
    return makeDynString(jsonEncode(makeMapping("project", PROJ)), "Status: 200 OK");
  }

  //--------------------------------------------------------------------------------
  public static void closeCB(string ip, int connectionIndex)
  {
    client.removePmonCredentials(connectionIndex);
  }

//--------------------------------------------------------------------------------
//@protected members
//--------------------------------------------------------------------------------

//--------------------------------------------------------------------------------
//@private members
//--------------------------------------------------------------------------------

  private static MarketplaceClient client = nullptr;

  private static void initMarketplaceClient()
  {
    client =  new MarketplaceClient();
  }

  private static string joinPath(string base, string name)
  {
    base = makeNativePath(base);
    if (base[strlen(base) - 1] != '/')
    {
      base += "/";
    }
    return makeNativePath(base + name);
}

};
