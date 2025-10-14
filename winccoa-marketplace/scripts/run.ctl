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

  DebugN(client.listRepos());

  client.clone("https://github.com/winccoa/winccoa-vscode-plugin", "C:/WinCC_OA_Proj");

  client.pull("C:/WinCC_OA_Proj/winccoa-vscode-plugin");
}
