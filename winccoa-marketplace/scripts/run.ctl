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
  DebugTN("result of 'get all repos from winccoa organization'", client.listRepos("winccoa"));

  // clone with default target directory
  DebugTN("result of 'clone with default target directory'", client.clone("https://github.com/winccoa/winccoa-ae-js-mcpserver.git"));

  // clone with specified target directory
  DebugTN("result of 'clone with specified target directory'",client.clone("https://github.com/winccoa/winccoa-ae-js-mcpserver.git", "D:/test"));

  // pull existing repo
  DebugTN("result of 'pull existing repo'", client.pull("D:/test/winccoa-ae-js-mcpserver"));

  DebugTN("result of 'register project'", client.registerSubProjects(makeDynString("D:/test/winccoa-ae-js-mcpserver")));

  DebugTN("result of 'unregister project'", client.unregisterSubProjects(makeDynString("D:/test/winccoa-ae-js-mcpserver")));
}
