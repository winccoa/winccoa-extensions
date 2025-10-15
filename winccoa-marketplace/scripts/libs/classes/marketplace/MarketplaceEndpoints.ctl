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
    httpConnect(cloneRepo, MARKETPLACE_URL_PREFIX + "/cloneRepo", "application/json");
    httpConnect(pullRepo, MARKETPLACE_URL_PREFIX + "/pullRepo", "application/json");
    httpConnect(regSubProject, MARKETPLACE_URL_PREFIX + "/regSubProject", "application/json");
    httpConnect(unregister, MARKETPLACE_URL_PREFIX + "/unregister", "application/json");
    httpConnect(listProjects, MARKETPLACE_URL_PREFIX + "/listProjects", "application/json");
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
  public static dyn_string cloneRepo(const dyn_string &names, const dyn_string &values)
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

    bool success = client.clone(url, path);

    if (success)
    {
      return makeDynString("Successfully cloned " + url + " into " + path, "Status: 200 OK");
    }
    else
    {
      return makeDynString(jsonEncode(makeMapping("error", "Couldn't clone repository " + url + " into " + path)), "Status: 500 Internal Server Error");
    }
  }


  //--------------------------------------------------------------------------------
  public static dyn_string pullRepo(const dyn_string &names, const dyn_string &values)
  {
    int idx = names.indexOf("repo");
    if (idx < 0)
    {
      return makeDynString("Missing required parameter: repo", "Status: 400 Bad Request");
    }
    string repo = values.at(idx);

    bool success = client.pull(repo);

    if (success)
    {
      return makeDynString("Successfully pulled repository " + repo, "Status: 200 OK");
    }
    else
    {
      return makeDynString(jsonEncode(makeMapping("error", "Couldn't pull repository " + repo)), "Status: 500 Internal Server Error");
    }
  }


  //--------------------------------------------------------------------------------
  public static dyn_string regSubProject(const dyn_string &names, const dyn_string &values)
  {
    int idx = names.indexOf("path");
    if (idx < 0)
    {
      return makeDynString("Missing required parameter: path", "Status: 400 Bad Request");
    }
    string path = values.at(idx);

    bool success = client.registerSubProjects(makeDynString(path));

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
  public static dyn_string unregister(const dyn_string &names, const dyn_string &values)
  {
    int idx = names.indexOf("path");
    if (idx < 0)
    {
      return makeDynString("Missing required parameter: path", "Status: 400 Bad Request");
    }
    string path = values.at(idx);

    bool delete = true;
    idx = names.indexOf("delete");
    if (idx >= 0)
    {
      delete = values.at(idx) == "true";
    }

    bool success = client.unregisterSubProjects(makeDynString(path));

    if (success)
    {
      return makeDynString("Successfully unregistered subproject from " + path, "Status: 200 OK");
    }
    else
    {
      return makeDynString(jsonEncode(makeMapping("error", "Couldn't unregister subproject from " + path)), "Status: 500 Internal Server Error");
    }
  }

  //--------------------------------------------------------------------------------
  public static dyn_string listProjects()
  {
    dyn_string response = client.listProjects();
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
};
