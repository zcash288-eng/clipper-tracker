# Project Rules for Clipper Tracker

These rules must be followed when writing or modifying any code in this project to prevent the recurrence of bugs identified in the deep audit.

## 1. Security & DOM Manipulation
- **Never use `innerHTML` with unsanitized data.** All data sourced from APIs, scrapers, or user input MUST be passed through `escapeHTML()` before being interpolated into `innerHTML`.
- **No inline JavaScript.** Do not use `onclick="..."` string interpolation in HTML. Always use `addEventListener` and data attributes.
- **Defensive DOM Checks:** Always use null guards (`if (element)`) before attaching event listeners or accessing properties of DOM elements, especially for top-level script execution.

## 2. API & Server Security
- **Secure Endpoints:** Do not expose raw secrets (`bufferToken`, `igSessionId`, etc.) in API responses. Filter them out.
- **Payload Validation:** Validate all incoming `req.body` payloads in POST/PUT requests before modifying the database. Ensure they match expected schemas (e.g., check that it is an array, has required fields).
- **Safe Proxies:** Any proxy endpoints must strictly validate protocols (http/https), content types, and block all private/internal IP ranges (SSRF protection).

## 3. Concurrency & Reliability
- **Write Locks:** The file-based JSON database (`data/db.json`) is prone to race conditions. Always use a mutex or lock when performing read-modify-write operations across asynchronous boundaries.
- **Graceful Failure:** Wrap third-party API calls (YouTube scraping, Buffer API) in `try/catch` blocks. Do not let one failed sub-task (like a missing RSS feed) crash the entire sync process.
- **Rate Limiting:** Implement delays in background loops that make external requests to avoid being blocked by third-party APIs.

## 4. UI Architecture
- **Semantic Structure:** Ensure correct HTML nesting (e.g., `<section>` elements must be properly nested inside `<main>`).
- **CSS Best Practices:** Avoid inline `style="..."` attributes. Maintain responsive design grids and manage `z-index` consistently.
