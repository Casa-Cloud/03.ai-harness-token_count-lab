import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { readEvents } from "./event-stream.mjs";
import "./styles.css";
import FinalAnswer from "./FinalAnswer";

const initialGoal = "Get the current temperature in Singapore, use calculate to convert it to Fahrenheit, then summarize.";

function App() {
  const activeRun = useRef(null);
  useEffect(() => () => activeRun.current?.abort(), []);
  const [approval, setApproval] = useState(null);
  const [approvalBusy, setApprovalBusy] = useState(false);
  const [approvalError, setApprovalError] = useState("");
  const [goal, setGoal] = useState(initialGoal);
  const [events, setEvents] = useState([]);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState({ loading: true });

  useEffect(() => {
    fetch("/api/health").then((r) => r.json()).then(setStatus).catch(() => setStatus({ configured: false }));
  }, []);

  async function runLoop(event) {
    event.preventDefault();
    if (activeRun.current) return;
    const controller = new AbortController();
    activeRun.current = controller;
    setRunning(true);
    setEvents([]);
    setApproval(null);
    setApprovalError("");
    try {
      const response = await fetch("/api/run", { signal: controller.signal, method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ goal }) });
      if (!response.ok) throw new Error((await response.json()).error || "Could not start the loop.");
      await readEvents(response.body, (event) => {
        setEvents((old) => [...old, event]);
        if (event.type === "approval_required") setApproval(event);
        if (["approved", "rejected"].includes(event.type)) setApproval(null);
      });
    } catch (error) {
      setEvents((old) => [...old, controller.signal.aborted
        ? { type: "cancelled", title: "Run cancelled", message: "Stopped this run and closed the connection to the backend." }
        : { type: "error", message: error.message }]);
    } finally { activeRun.current = null; setRunning(false); setApproval(null); }
  }

  async function answerApproval(approved) {
    if (!approval || approvalBusy) return;
    setApprovalBusy(true);
    setApprovalError("");
    try {
      const response = await fetch(`/api/approvals/${approval.approvalId}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approved }), signal: activeRun.current?.signal
      });
      if (!response.ok) throw new Error((await response.json()).error);
      setApproval((current) => current?.approvalId === approval.approvalId ? null : current);
    } catch (error) { if (error.name !== "AbortError") setApprovalError(error.message); }
    finally { setApprovalBusy(false); }
  }

  return <main>
    <section className="intro">
      <p className="eyebrow">NO FRAMEWORK • EXPLICIT STATE</p>
      <h1>Harness Engineering <span>Lab</span></h1>
      <p className="lede">A tiny Node.js agent where each state transition is visible: decide → act → observe → repeat.</p>
    </section>
    <section className="workbench">
      <form onSubmit={runLoop}>
        <label htmlFor="goal">Agent goal</label>
        <textarea id="goal" value={goal} onChange={(e) => setGoal(e.target.value)} disabled={running} />
        <button disabled={running || !goal.trim()}>{running ? "Loop running…" : "Run agent loop"}</button>
        {running && <button type="button" className="cancel" onClick={() => activeRun.current?.abort()}>Cancel run</button>}
        <p className={status.configured ? "configured" : "unconfigured"}>
          {status.loading ? "Checking configuration…" : status.configured ? `LLM ready: ${status.model}` : "LLM not configured — add AZURE_OPENAI_KEY, AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_DEPLOYMENT, and AZURE_OPENAI_API_VERSION to .env"}
        </p>
        {!status.loading && <ModelInfo model={status.model} />}
      </form>
      <div className="trace" aria-live="polite">
        <div className="trace-header">
          <span>LIVE TRACE</span>
          <div className="trace-actions">
            <span>{events.length} events</span>
            <button type="button" className="clear-events" disabled={events.length === 0} onClick={() => setEvents([])}>Clear events</button>
          </div>
        </div>
        {approval && <section className="approval" aria-label="Human approval required">
          <h2>Approval required</h2>
          <p>{approval.message}</p>
          {approval.payload.yaml ? <>
            <p><strong>Command:</strong> <code>{approval.payload.command}</code></p>
            <p>{approval.payload.effect}</p>
            <div className="yaml-preview"><div className="yaml-heading">YAML manifest</div><pre>{approval.payload.yaml.split('\n').map((line, i) => <div className="yaml-line" key={i}><span className="yaml-number">{i + 1}</span><code>{line || ' '}</code></div>)}</pre></div>
            <p className="manifest-path">Saved file: {approval.payload.file}</p>
          </> : <pre>{JSON.stringify(approval.payload, null, 2)}</pre>}
          <div className="approval-actions">
            <button type="button" disabled={approvalBusy} onClick={() => answerApproval(true)}>Approve</button>
            <button type="button" className="cancel" disabled={approvalBusy} onClick={() => answerApproval(false)}>Reject</button>
          </div>
          {approvalError && <p role="alert">{approvalError}</p>}
        </section>}
        {events.length === 0 ? <div className="empty">{running ? "Waiting for the next event…" : "Press “Run agent loop” to expose the agent’s state changes."}</div> : events.map((event, i) => <Event key={i} event={event} />)}
      </div>
    </section>
    <footer><code>for (let step = 1; step &lt;= maxSteps; step += 1)</code><span>Weather data: <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">Open-Meteo</a></span></footer>
  </main>;
}

function ModelInfo({ model }) {
  return <section className="model-info" aria-label="Model limits and economics">
    <div className="model-info-heading"><span>MODEL PROFILE</span><strong>{model || "No model selected"}</strong></div>
    <p className="tokenization-note"><strong>Tokenization</strong> Text is split into model-specific tokens. The same text can count differently across models, so this trace reports the actual count returned for each query.</p>
    <p className="metadata-note">Context limits, maximum output, pricing, and rate limits are not returned by the runtime response. This app does not ask you to enter them manually.</p>
  </section>;
}

function Event({ event }) {
  const labels = { approval_required: "APPROVAL", approved: "APPROVED", rejected: "REJECTED", run_started: "SERVER", llm_request: "LLM REQUEST", llm_response: "LLM RESPONSE", parsed: "VALIDATE", decision: "BRANCH", tool_call: "TOOL CALL", tool_result: "TOOL RESULT", history_updated: "HISTORY", completed: "RETURN", stopped: "LIMIT", cancelled: "CANCELLED", error: "ERROR" };
  return <article className={`event ${event.type}`}>
    <div className="event-label">{labels[event.type] || event.type}{event.step && <span className="step">Iteration {event.step}</span>}</div>
    <div className="event-content">
      <h2>{event.title || "The run encountered an error"}</h2>
      {event.code && <code className="source-code">server.js · {event.code}</code>}
      {event.type === "llm_response" && event.usage && <div className="token-usage" aria-label="LLM token usage">
        <span><strong>{formatTokenCount(event.usage.promptTokens)}</strong> input</span>
        <span><strong>{formatTokenCount(event.usage.completionTokens)}</strong> output</span>
        <span><strong>{formatTokenCount(event.usage.totalTokens)}</strong> total</span>
        {event.usage.model && <span className="token-model">{event.usage.model}</span>}
      </div>}
      <div className="event-text">{event.type === "completed" ? <FinalAnswer>{event.answer || ""}</FinalAnswer> : <p>{event.answer || event.message || event.reason}</p>}</div>
      {event.payload !== undefined && <details open={event.type !== "history_updated"}>
        <summary>{event.type === "llm_request" ? "Exact request body / prompt" : event.type === "llm_response" ? "Decision from the LLM" : event.type === "history_updated" ? "History for the next prompt" : "Data at this step"}</summary>
        <pre>{JSON.stringify(event.payload, null, 2)}</pre>
      </details>}
    </div>
  </article>;
}

function formatTokenCount(value) {
  return value == null ? "—" : value.toLocaleString();
}

createRoot(document.getElementById("root")).render(<App />);
