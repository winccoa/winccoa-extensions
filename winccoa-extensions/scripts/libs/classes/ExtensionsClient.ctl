// $License: NOLICENSE
//--------------------------------------------------------------------------------
/**
  @file $relPath
  @copyright $copyright
  @author Jonas Schulz
*/

//--------------------------------------------------------------------------------
// Libraries used (#uses)
#uses "vrpc"
//--------------------------------------------------------------------------------
// Variables and Constants

//--------------------------------------------------------------------------------
/**
*/
class ExtensionsClient
{
  private VrpcStub stub = nullptr;

  public ExtensionsClient()
  {
    stub = VrpcStub::createAndInitialize("extensions", new VrpcStubOptions());
  }

  public anytype listRepos(string organization = "winccoa")
  {
    VrpcResponseData response = stub.callFunction("listRepos", organization);
    return jsonDecode(response.getResponse());
  }

  public mapping clone(string url, string path = "")
  {
    mapping request = makeMapping("url", url, "targetDirectory", path);
    VrpcResponseData response = stub.callFunction("clone", request);
    return response.getResponse();
  }

  public mapping pull(mapping request)
  {
    VrpcResponseData response = stub.callFunction("pull", request);
    return response.getResponse();
  }

  public bool registerSubProjects(mapping request)
  {
    VrpcResponseData response = stub.callFunction("register", request);
    return response.getResponse();
  }

  public bool unregisterSubProjects(mapping request)
  {
    VrpcResponseData response = stub.callFunction("unregister", request);
    return response.getResponse();
  }

  public bool remove(string path)
  {
    VrpcResponseData response = stub.callFunction("remove", path);
    return response.getResponse();
  }
  public string repoPath()
  {
    VrpcResponseData response = stub.callFunction("repoPath", nullptr);
    return response.getResponse();
  }

  public dyn_string listSubProjects()
  {
    VrpcResponseData response = stub.callFunction("subProjects", nullptr);
    return response.getResponse();
  }

  public string listLocalRepos()
  {
    VrpcResponseData response = stub.callFunction("localRepos", nullptr);
    return response.getResponse();
  }

  public bool setPmonCredentials(string session, string user, string password)
  {
    mapping requestMap;
    requestMap.insert("session", session);
    requestMap.insert("user", user);
    requestMap.insert("password", password);
    VrpcResponseData response = stub.callFunction("setPmonCredentials", requestMap);
    return response.getResponse();
  }

  public bool verifyPmonCredentials(string session)
  {
    VrpcResponseData response = stub.callFunction("verifyPmonCredentials", session);
    return response.getResponse();
  }

  public bool removePmonCredentials(string session)
  {
    VrpcResponseData response = stub.callFunction("removePmonCredentials", session);
    return response.getResponse();
  }
};
