// $License: NOLICENSE
//--------------------------------------------------------------------------------
/**
  @file $relPath
  @copyright $copyright
  @author Jonas Schulz
*/

//--------------------------------------------------------------------------------
// Libraries used (#uses)
#uses "classes/MarketplaceClient"
//--------------------------------------------------------------------------------
// Variables and Constants

//--------------------------------------------------------------------------------
/**
*/
void main()
{
  MarketplaceClient client =  new MarketplaceClient();

  // NOTE: change path of repo etc. for developer tests

  // get all repos from winccoa organization
  DebugTN("result of 'get all repos from winccoa organization'", client.listRepos("winccoa")); // GEHT

  // clone with default target directory
  DebugTN("result of 'clone with default target directory'", client.clone("https://github.com/winccoa/greece_test_addon.git", "D:/test")); // GEHT

  // clone with specified target directory
  DebugTN("result of 'clone with specified target directory'",client.clone("https://github.com/winccoa/winccoa-ae-js-mcpserver.git", "D:/test"));

  // pull existing repo
  DebugTN("result of 'pull existing repo'", client.pull("D:/test/greece_test_addon")); // GEHT

  mapping mRepo;
  mRepo.insert("repositoryPath", "D:/test/greece_test_addon");
  mRepo.insert("fileContent", "{\"RepoName\":\"greece_test_addon\",\"Keywords\":[\"javascript\"],\"Subproject\":\"testSubProject\",\"Version\":\"1.0.0\",\"Description\":\"This is a test\",\"OaVersion\":\"^3.21.0\",\"Managers\":[{\"Name\":\"WCCOActrl\",\"StartMode\":\"always\",\"Options\":\"-num 10 test.ctl\"}],\"Dplists\":[\"test.dpl\"]}");

  DebugTN("result of 'register project'", client.registerSubProjects(mRepo)); // GEHT

  mRepo.insert("deleteFiles", TRUE);

  DebugTN("result of 'unregister project'", client.unregisterSubProjects(mRepo));
}
