const { default: handler } = require('../api/contact');

exports.handler = async (event, context) => {
  const req = {
    method: event.httpMethod,
    body: event.body || '{}',
    headers: event.headers || {},
    queryStringParameters: event.queryStringParameters || {}
  };

  const res = {
    statusCode: 200,
    headers: {},
    body: '',
    setHeader(name, value) {
      this.headers[name] = value;
    },
    end(body) {
      this.body = body;
      return this;
    },
    writeHead(code, headers) {
      this.statusCode = code;
      this.headers = { ...this.headers, ...headers };
    }
  };

  await handler(req, res);

  return {
    statusCode: res.statusCode,
    headers: res.headers,
    body: res.body
  };
};
