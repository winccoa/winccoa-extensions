#uses "classes/HttpServer"
#uses "classes/extensions/ExtensionsEndpoints"

HttpServer http;

main()
{
  http.start();

  // connect endpoints for Extensions
  ExtensionsEndpoints::connectEndpoints(http.getHttpsPort());
}
