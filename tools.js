const { validateKubernetes, runKubernetes } = require("./kubernetes");
const { prepareManifest } = require("./manifests");
async function fetchWeatherJson(url, signal) {
  const response = await fetch(url, { signal: signal || AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error(`Open-Meteo returned HTTP ${response.status}.`);
  return response.json();
}

const tools = {
  kubernetes: {
    requiresApproval: ({ command }) => ["delete", "create_yaml"].includes(command),
    approvalPolicy: "delete and create_yaml require human approval. Resource creation must use create_yaml to review generated YAML.",
    validateInput: validateKubernetes,
    prepareInput: prepareManifest,
    timeoutMs: 60000, permission: "cluster-access",
    inputSchema: { type: "object", properties: { command: { type: "string", minLength: 1, maxLength: 40 }, args: { type: "array", items: { type: "string" }, maxItems: 100 }, manifest: { type: "string", minLength: 2, maxLength: 100000 } }, required: ["command"], additionalProperties: false },
    description: 'Execute a kubectl built-in command using the backend kubeconfig. Pass the verb separately from arguments: {"command":"get","args":["pods","-n","default","-o","json"]}. To create a Pod, Deployment, Service, or other resource, use command create_yaml and manifest containing the resource serialized as JSON; omit args. The backend generates a YAML file for human review before kubectl create. delete also requires approval. No shell expansion, pipes, interactive sessions, or persistent connections. Output is bounded and commands time out after 60 seconds.',
    run: runKubernetes
  },
  get_weather: {
    timeoutMs: 20000, permission: "read-only",
    inputSchema: { type: "object", properties: { city: { type: "string", minLength: 1, maxLength: 200 } }, required: ["city"], additionalProperties: false },
    description: "Get current weather in Celsius for a city using Open-Meteo. Uses the first matching location and returns its name and country.",
    run: async ({ city = "" }, { signal }) => {
      if (typeof city !== "string" || !city.trim()) return { error: "Provide a city name." };
      try {
        const locations = await fetchWeatherJson(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city.trim())}&count=1&language=en&format=json`, signal);
        const location = locations.results?.[0];
        if (!location) return { error: `No location found for "${city}". Try a different city name.` };
        const weather = await fetchWeatherJson(`https://api.open-meteo.com/v1/forecast?latitude=${location.latitude}&longitude=${location.longitude}&current=temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m&temperature_unit=celsius&wind_speed_unit=kmh&timezone=auto`, signal);
        if (!Number.isFinite(weather.current?.temperature_2m)) return { error: "Current temperature is unavailable for this location." };
        return {
          location: { city: location.name, region: location.admin1 || "", country: location.country, latitude: location.latitude, longitude: location.longitude },
          time: weather.current.time,
          timezone: weather.timezone,
          temperature_c: weather.current.temperature_2m,
          humidity_percent: weather.current.relative_humidity_2m,
          precipitation_mm: weather.current.precipitation,
          wind_speed_kmh: weather.current.wind_speed_10m,
          source: "https://open-meteo.com/"
        };
      } catch (error) {
        signal?.throwIfAborted();
        return { error: `Weather lookup failed: ${error.message}` };
      }
    }
  },
  calculate: {
    timeoutMs: 1000, permission: "local",
    inputSchema: { type: "object", properties: { expression: { type: "string", minLength: 1, maxLength: 200, pattern: "^[0-9+*/().\\s-]+$" } }, required: ["expression"], additionalProperties: false },
    description: "Calculate a basic arithmetic expression using numbers and + - * / parentheses.",
    run: ({ expression = "" }) => {
      if (!/^[0-9+*/().\s-]+$/.test(expression)) return { error: "Only basic arithmetic is allowed." };
      try {
        // The input is restricted above; this is intentionally tiny for a demo tool.
        return { expression, result: Function(`"use strict"; return (${expression})`)() };
      } catch {
        return { error: "That expression could not be calculated." };
      }
    }
  }
};

module.exports = { tools };
