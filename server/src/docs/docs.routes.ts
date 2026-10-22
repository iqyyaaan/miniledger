import { Router } from 'express';
import { buildOpenApiDocument } from './openapi.js';

export const docsRouter = Router();

/** The machine-readable contract — importable into Postman, Insomnia, codegen. */
docsRouter.get('/openapi.json', (req, res) => {
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  res.status(200).json(buildOpenApiDocument(baseUrl));
});

/**
 * Human-readable docs. Scalar is loaded from a CDN rather than vendored,
 * which keeps the dependency out of `package.json` — it is a development
 * convenience, not something the API needs to function.
 */
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
