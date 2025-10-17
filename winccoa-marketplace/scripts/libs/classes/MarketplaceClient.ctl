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
class MarketplaceClient
{
  private VrpcStub stub = nullptr;

  public MarketplaceClient()
  {
    stub = VrpcStub::createAndInitialize("marketplace", new VrpcStubOptions());
  }

  public anytype listRepos(string organization = "winccoa")
  {
    VrpcResponseData response = stub.callFunction("listRepos", organization);
    DebugTN(__FUNCTION__, "VRPC STATUS: ", response.getStatus());
    return jsonDecode(response.getResponse());
  }

  public mapping clone(string url, string path = "")
  {
    mapping request = makeMapping("url", url, "targetDirectory", path);
    VrpcResponseData response = stub.callFunction("clone", request);
    DebugTN(__FUNCTION__, "VRPC STATUS: ", response.getStatus());
    return response.getResponse();
  }

  public mapping pull(string urlOrName)
  {
    VrpcResponseData response = stub.callFunction("pull", urlOrName);
    DebugTN(__FUNCTION__, "VRPC STATUS: ", response.getStatus());
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
};
