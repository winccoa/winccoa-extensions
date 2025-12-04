#uses "classes/HttpServer"
#uses "classes/marketplace/MarketplaceEndpoints"

HttpServer http;

main()
{
  http.start();

  // connect endpoints for Marketplace
  MarketplaceEndpoints::connectEndpoints(http.getHttpsPort());
}
