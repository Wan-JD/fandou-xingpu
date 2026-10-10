interface Env {
  API: Fetcher;
}

export const onRequest: PagesFunction<Env> = async (context) => {
  const requestUrl = new URL(context.request.url);
  const target = new URL(requestUrl);
  target.hostname = "fandou-xingpu-api";
  return context.env.API.fetch(new Request(target, context.request));
};
