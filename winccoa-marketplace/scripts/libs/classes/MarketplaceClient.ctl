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

  public string clone(string url, string path = "")
  {
    mapping request = makeMapping("url", url, "targetDirectory", path);
    VrpcResponseData response = stub.callFunction("clone", request);
    DebugTN(__FUNCTION__, "VRPC STATUS: ", response.getStatus());
    return response.getResponse();
  }

  public int pull(string urlOrName)
  {
    VrpcResponseData response = stub.callFunction("pull", urlOrName);
    DebugTN(__FUNCTION__, "VRPC STATUS: ", response.getStatus());
    return response.getResponse();
  }

  public bool registerSubProjects(dyn_string paths)
  {
    VrpcResponseData response = stub.callFunction("register", paths);
    return response.getResponse();
  }

  public bool unregisterSubProjects(dyn_string paths)
  {
    VrpcResponseData response = stub.callFunction("unregister", paths);
    return response.getResponse();
  }

  public dyn_string listProjects()
  {
    VrpcResponseData response = stub.callFunction("listProjects", nullptr);
    return response.getResponse();
  }

};
