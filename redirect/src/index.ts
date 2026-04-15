export default {
  fetch(request: Request): Response {
    const url = new URL(request.url)
    url.hostname = 'dash.ailedger.dev'
    return Response.redirect(url.toString(), 301)
  },
}
