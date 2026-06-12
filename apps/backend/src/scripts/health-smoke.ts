import { createBackendApp } from "../app.js";
import { getBackendConfig } from "../config.js";

const app = createBackendApp(getBackendConfig());
console.log(JSON.stringify(app.health(), null, 2));
app.close();
