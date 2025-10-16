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
    httpConnect(delete, MARKETPLACE_URL_PREFIX + "/delete", "application/json");
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


    try
    {
      string path = client.repoPath() + repoName;
      mapping result = client.pull(path);
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

    mapping requestMapping;
    string path = client.repoPath() + repoName;
    requestMapping.insert("repositoryPath", path);
    requestMapping.insert("fileContent", fileContent);

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
    string path = client.repoPath() + repoName;
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
  public static dyn_string delete(const dyn_string &names, const dyn_string &values)
  {
    int idx = names.indexOf("repoName");
    if (idx < 0)
    {
      return makeDynString("Missing required parameter: repoName", "Status: 400 Bad Request");
    }
    string repoName = values.at(idx);

    try
    {
      string path = client.repoPath() + repoName;
      mapping result = client.delete(path);
      result.insert("message", "Successfully deleted repository " + repoName);
      return makeDynString(jsonEncode(result), "Status: 200 OK");
    }
    catch
    {
      return makeDynString(jsonEncode(makeMapping("error", "Couldn't delete repository " + repoName)), "Status: 500 Internal Server Error");
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
