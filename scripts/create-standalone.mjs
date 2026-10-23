import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";

const root = resolve(import.meta.dirname, "..");
const rawSource = readFileSync(resolve(root, "src/App.tsx"), "utf8");
// Hooks réellement importés depuis React, exposés depuis le global React dans la version CDN.
const reactImport = rawSource.match(/^import \{([^}]+)\} from "react";/m);
const reactHooks = reactImport
  ? reactImport[1]
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean)
      .join(", ")
  : "useEffect, useMemo, useRef, useState";
const appSource = rawSource
  .replace(/^import(?: type)? .*?;\s*$/gm, "")
  .replace("export default function App()", "function App()");
const css = readFileSync(resolve(root, "src/index.css"), "utf8").replace(
  /^@import\s+["']tailwindcss["'];\s*/m,
  "",
);

// Keep JSX for Babel in the browser while TypeScript removes the type annotations.
const appJsx = ts.transpileModule(appSource, {
  compilerOptions: {
    jsx: ts.JsxEmit.Preserve,
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.None,
  },
}).outputText;

const html = `<!doctype html>
<html lang="fr">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="theme-color" content="#0C3460" />
  <meta name="description" content="JZ KALYPHOR, votre espace pédagogique pour prendre le contrôle de votre avenir professionnel." />
  <title>JZ KALYPHOR | Espace pédagogique</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Montserrat:wght@500;600;700;800&display=swap" rel="stylesheet" />
  <script src="https://unpkg.com/react@18.3.1/umd/react.production.min.js" crossorigin></script>
  <script src="https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js" crossorigin></script>
  <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
  <script src="https://unpkg.com/@babel/standalone@7.26.9/babel.min.js"></script>
  <style>${css}</style>
</head>
<body>
  <div id="root"></div>
  <script type="text/babel" data-presets="react">
    const { ${reactHooks} } = React;
    ${appJsx}
    ReactDOM.createRoot(document.getElementById("root")).render(<App />);
  </script>
</body>
</html>
`;

const output = resolve(root, "jz-kalyphor.html");
writeFileSync(output, html);
console.log(`Created ${output} (${Math.round(html.length / 1024)} KB)`);
