import { Router } from 'express';
import { buildOpenApiDocument } from './openapi.js';

export const docsRouter = Router();

// the machine-readable contract, importable straight into Postman/Insomnia/codegen
docsRouter.get('/openapi.json', (req, res) => {
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  res.status(200).json(buildOpenApiDocument(baseUrl));
});

// human-readable docs page. Scalar loads from a CDN instead of being
// vendored in — it's a dev convenience, not something the API actually
// needs to run, so no reason to add it as a real dependency
docsRouter.get('/', (_req, res) => {
  res.type('html').status(200).send(`<!doctype html>
<html>
  <head>
    <title>MiniLedger API</title>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
  </head>
  <body>
    <script id="api-reference" data-url="/api/docs/openapi.json"></script>
    <script>
      var configuration = { theme: 'purple', layout: 'modern' };
      document.getElementById('api-reference').dataset.configuration = JSON.stringify(configuration);
    </script>
    <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
  </body>
</html>`);
});
