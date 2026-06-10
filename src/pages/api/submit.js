// src/pages/api/submit.js
import { env } from "cloudflare:workers";

export const POST = async ({ request }) => { // removed locals argument
  try {
    const data = await request.json();
    let { name, email, message } = data;

    if (!name || !email || !message) {
      return new Response(JSON.stringify({ error: "All fields are required." }), { status: 400 });
    }

    name = name.trim();
    email = email.trim();
    message = message.trim();

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return new Response(JSON.stringify({ error: "Invalid email address format." }), { status: 400 });
    }

    if (name.length > 100 || message.length > 2000) {
      return new Response(JSON.stringify({ error: "Input exceeds maximum allowed length." }), { status: 400 });
    }

    const sanitize = (str) => str.replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const cleanName = sanitize(name);
    const cleanEmail = sanitize(email);
    const cleanMessage = sanitize(message);

    const id = crypto.randomUUID(); 
    const db = env.portfolio_db; // <-- Updated target

    await db.prepare(
      "INSERT INTO submissions (id, name, email, message) VALUES (?, ?, ?, ?)"
    )
    .bind(id, cleanName, cleanEmail, cleanMessage)
    .run();

    return new Response(JSON.stringify({ success: true, message: "Submission received successfully!" }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: "Server error processing your request." }), { status: 500 });
  }
};