"use strict";

document.querySelector("#loginForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('[type="submit"]');
    const message = document.querySelector("#loginMessage");
    const values = new FormData(form);
    button.disabled = true;
    message.textContent = "Signing in...";
    try {
        const response = await fetch("/api/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                username: values.get("username"),
                password: values.get("password")
            })
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Sign-in failed.");
        window.location.assign("/admin");
    } catch (error) {
        message.textContent = error.message || "Could not reach the server. Try again.";
        button.disabled = false;
    }
});
