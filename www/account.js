"use strict";

const accessPanel = document.querySelector("#accountAccess");
const dashboard = document.querySelector("#accountDashboard");
const accountMessage = document.querySelector("#accountMessage");
const accountOrders = document.querySelector("#accountOrders");
let csrfToken = "";

function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (character) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    })[character]);
}

function formatPrice(value) {
    return new Intl.NumberFormat("en-NG", {
        style: "currency",
        currency: "NGN",
        maximumFractionDigits: 0
    }).format(value);
}

async function request(url, options = {}) {
    const response = await fetch(url, {
        ...options,
        headers: {
            ...(options.body ? { "Content-Type": "application/json" } : {}),
            ...(options.method && options.method !== "GET" ? { "X-CSRF-Token": csrfToken } : {}),
            ...options.headers
        }
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "The request could not be completed.");
    return result;
}

function showAccess(message = "") {
    accessPanel.hidden = false;
    dashboard.hidden = true;
    accountMessage.textContent = message;
}

function showDashboard(customer) {
    accessPanel.hidden = true;
    dashboard.hidden = false;
    document.querySelector("#customerName").textContent = customer.name;
    document.querySelector("#customerContact").textContent = `${customer.email} · ${customer.phone}`;
}

async function loadOrders() {
    const orders = await request("/api/account/orders");
    accountOrders.innerHTML = orders.map((order) => `
        <article class="account-order">
            <div>
                <strong>${escapeHtml(order.id)}</strong>
                <small>${escapeHtml(new Date(order.createdAt).toLocaleString())}</small>
            </div>
            <div>${order.items.map((item) => `${escapeHtml(item.name)} × ${item.quantity}`).join("<br>")}</div>
            <strong>${formatPrice(order.total)}</strong>
            <span class="order-status">${escapeHtml(order.status)}</span>
        </article>
    `).join("") || '<p class="account-intro">No orders have been placed while signed in yet. You can still place an order as a guest.</p>';
}

document.querySelector("#showLogin").addEventListener("click", () => {
    document.querySelector("#loginForm").hidden = false;
    document.querySelector("#signupForm").hidden = true;
    document.querySelector("#showLogin").classList.add("active");
    document.querySelector("#showSignup").classList.remove("active");
    document.querySelector("#accountTitle").textContent = "Sign in";
    accountMessage.textContent = "";
});

document.querySelector("#showSignup").addEventListener("click", () => {
    document.querySelector("#loginForm").hidden = true;
    document.querySelector("#signupForm").hidden = false;
    document.querySelector("#showLogin").classList.remove("active");
    document.querySelector("#showSignup").classList.add("active");
    document.querySelector("#accountTitle").textContent = "Create account";
    accountMessage.textContent = "";
});

document.querySelector("#loginForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = event.currentTarget.querySelector('[type="submit"]');
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form));
    values.acceptedPolicies = form.elements.acceptedPolicies.checked;
    button.disabled = true;
    accountMessage.textContent = "Signing in...";
    try {
        const result = await request("/api/account/login", {
            method: "POST",
            body: JSON.stringify(values)
        });
        csrfToken = result.csrfToken;
        showDashboard(result.customer);
        await loadOrders();
    } catch (error) {
        accountMessage.textContent = error.message;
    } finally {
        button.disabled = false;
    }
});

document.querySelector("#signupForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = event.currentTarget.querySelector('[type="submit"]');
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form));
    values.acceptedPolicies = form.elements.acceptedPolicies.checked;
    button.disabled = true;
    accountMessage.textContent = "Creating your account...";
    try {
        const result = await request("/api/account/register", {
            method: "POST",
            body: JSON.stringify(values)
        });
        csrfToken = result.csrfToken;
        showDashboard(result.customer);
        await loadOrders();
    } catch (error) {
        accountMessage.textContent = error.message;
    } finally {
        button.disabled = false;
    }
});

document.querySelector("#accountLogout").addEventListener("click", async () => {
    try {
        await request("/api/account/logout", { method: "POST" });
        csrfToken = "";
        showAccess("You have signed out.");
    } catch (error) {
        document.querySelector("#passwordMessage").textContent = error.message;
    }
});

document.querySelector("#passwordForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('[type="submit"]');
    const message = document.querySelector("#passwordMessage");
    const values = Object.fromEntries(new FormData(form));
    button.disabled = true;
    message.textContent = "Updating password...";
    try {
        await request("/api/account/password", {
            method: "POST",
            body: JSON.stringify(values)
        });
        form.reset();
        message.textContent = "Your password was updated.";
    } catch (error) {
        message.textContent = error.message;
    } finally {
        button.disabled = false;
    }
});

async function startAccount() {
    try {
        const result = await request("/api/account/session");
        if (!result.authenticated) {
            showAccess();
            return;
        }
        csrfToken = result.csrfToken;
        showDashboard(result.customer);
    } catch (error) {
        showAccess();
    }
    if (!dashboard.hidden) {
        try {
            await loadOrders();
        } catch (error) {
            accountOrders.textContent = error.message;
        }
    }
}

startAccount();
