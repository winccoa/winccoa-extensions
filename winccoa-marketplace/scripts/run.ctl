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
}
