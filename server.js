"use strict";

const http = require("node:http");
const { randomBytes, randomUUID, scryptSync, timingSafeEqual } = require("node:crypto");
const { chmod, readFile, rename, writeFile } = require("node:fs/promises");
const { readFileSync } = require("node:fs");
const path = require("node:path");

const root = __dirname;
try {
    const environmentFile = readFileSync(path.join(root, ".env"), "utf8");
    for (const line of environmentFile.split(/\r?\n/)) {
        const entry = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
        if (!entry || Object.hasOwn(process.env, entry[1])) continue;
        const value = entry[2].replace(/^(['"])(.*)\1$/, "$2");
        process.env[entry[1]] = value;
    }
} catch (error) {
    if (error.code !== "ENOENT") throw error;
}
const dataPath = process.env.STORE_DATA_PATH || path.join(root, "store-data.json");
const sessionCookie = "mom_admin";
const customerCookie = "mom_customer";
const sessionLifetime = 8 * 60 * 60 * 1000;
const customerSessionLifetime = 30 * 24 * 60 * 60 * 1000;
const maximumBodySize = 64 * 1024;
const allowedCategories = new Set(["Paint", "POP Materials"]);
const allowedOrderStatuses = new Set(["pending", "confirmed", "fulfilled", "cancelled"]);
const adminUsername = process.env.ADMIN_USERNAME;
const adminPassword = process.env.ADMIN_PASSWORD;

if (!adminUsername || !adminPassword || adminPassword.length < 12) {
    console.error("Set ADMIN_USERNAME and ADMIN_PASSWORD (at least 12 characters) before starting the server.");
    process.exit(1);
}

const passwordSalt = randomBytes(16);
const expectedPasswordHash = scryptSync(adminPassword, passwordSalt, 64);
const sessions = new Map();
const customerSessions = new Map();
const loginAttempts = new Map();
const customerLoginAttempts = new Map();
const customerRegistrationAttempts = new Map();
const orderAttempts = new Map();
let writeQueue = Promise.resolve();

const securityHeaders = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "same-origin",
    "Content-Security-Policy": "default-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https:; script-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"
};

class HttpError extends Error {
    constructor(statusCode, message) {
        super(message);
        this.statusCode = statusCode;
    }
}

function send(response, statusCode, contentType, body, extraHeaders = {}) {
    response.writeHead(statusCode, {
        ...securityHeaders,
        "Cache-Control": "no-store",
        "Content-Type": contentType,
        ...extraHeaders
    });
    response.end(body);
}

function sendJson(response, statusCode, payload, extraHeaders = {}) {
    send(response, statusCode, "application/json; charset=utf-8", JSON.stringify(payload), extraHeaders);
}

async function sendFile(response, filePath, contentType) {
    const contents = await readFile(filePath);
    send(response, 200, contentType, contents);
}

async function readBody(request) {
    let body = "";
    for await (const chunk of request) {
        body += chunk;
        if (Buffer.byteLength(body) > maximumBodySize) {
            throw new HttpError(413, "Request body is too large.");
        }
    }
    try {
        return JSON.parse(body);
    } catch {
        throw new HttpError(400, "A valid JSON request body is required.");
    }
}

async function readStore() {
    const store = JSON.parse(await readFile(dataPath, "utf8"));
    store.customers ||= [];
    return store;
}

async function ensureStoreFile() {
    try {
        await readFile(dataPath);
    } catch (error) {
        if (error.code !== "ENOENT") throw error;
        const initialStore = await readFile(path.join(root, "store-data.example.json"));
        try {
            await writeFile(dataPath, initialStore, { flag: "wx", mode: 0o600 });
        } catch (writeError) {
            if (writeError.code !== "EEXIST") throw writeError;
        }
    }
    await chmod(dataPath, 0o600);
}

async function saveStore(store) {
    const temporaryPath = `${dataPath}.${randomUUID()}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
    await rename(temporaryPath, dataPath);
}

function mutateStore(transaction) {
    const result = writeQueue.then(async () => {
        const store = await readStore();
        const value = await transaction(store);
        await saveStore(store);
        return value;
    });
    writeQueue = result.catch(() => {});
    return result;
}

function getCookies(request) {
    const cookies = new Map();
    for (const pair of (request.headers.cookie || "").split(";")) {
        const separator = pair.indexOf("=");
        if (separator > 0) cookies.set(pair.slice(0, separator).trim(), pair.slice(separator + 1).trim());
    }
    return cookies;
}

function getSession(request) {
    const token = getCookies(request).get(sessionCookie);
    if (!token) return null;
    const session = sessions.get(token);
    if (!session) return null;
    if (session.expiresAt <= Date.now()) {
        sessions.delete(token);
        return null;
    }
    return { token, ...session };
}

function getCustomerSession(request) {
    const token = getCookies(request).get(customerCookie);
    if (!token) return null;
    const session = customerSessions.get(token);
    if (!session) return null;
    if (session.expiresAt <= Date.now()) {
        customerSessions.delete(token);
        return null;
    }
    return { token, ...session };
}

function requireSession(request) {
    const session = getSession(request);
    if (!session) throw new HttpError(401, "Admin sign-in is required.");
    return session;
}

function requireCustomerSession(request) {
    const session = getCustomerSession(request);
    if (!session) throw new HttpError(401, "Please sign in to your customer account.");
    return session;
}

function verifyCsrf(request, session) {
    const submitted = request.headers["x-csrf-token"];
    if (typeof submitted !== "string") throw new HttpError(403, "The request security token is missing.");
    const submittedBytes = Buffer.from(submitted);
    const expectedBytes = Buffer.from(session.csrfToken);
    if (submittedBytes.length !== expectedBytes.length || !timingSafeEqual(submittedBytes, expectedBytes)) {
        throw new HttpError(403, "The request security token is invalid.");
    }
}

function validateProduct(input) {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
        throw new HttpError(400, "Product details are required.");
    }
    const name = typeof input.name === "string" ? input.name.trim() : "";
    const description = typeof input.description === "string" ? input.description.trim() : "";
    const category = input.category;
    const image = typeof input.image === "string" ? input.image.trim() : "";
    if (!name || name.length > 100) throw new HttpError(400, "Enter a product name up to 100 characters.");
    if (!allowedCategories.has(category)) throw new HttpError(400, "Products must be Paint or POP Materials.");
    if (!description || description.length > 500) throw new HttpError(400, "Enter a description up to 500 characters.");
    if (!Number.isSafeInteger(input.price) || input.price < 1 || input.price > 1_000_000_000) {
        throw new HttpError(400, "Enter a valid product price.");
    }
    if (!Number.isSafeInteger(input.stock) || input.stock < 0 || input.stock > 1_000_000) {
        throw new HttpError(400, "Enter a valid stock quantity.");
    }
    if (image && image.length > 500) throw new HttpError(400, "Image URL is too long.");
    if (image) {
        let parsedImage;
        try {
            parsedImage = new URL(image);
        } catch {
            throw new HttpError(400, "Enter a valid HTTPS image URL.");
        }
        if (parsedImage.protocol !== "https:") throw new HttpError(400, "Image URLs must use HTTPS.");
    }
    return { name, category, description, price: input.price, stock: input.stock, image };
}

function validateCustomer(input) {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
        throw new HttpError(400, "Customer and order details are required.");
    }
    const name = typeof input.name === "string" ? input.name.trim() : "";
    const phone = typeof input.phone === "string" ? input.phone.trim() : "";
    const email = typeof input.email === "string" ? input.email.trim() : "";
    const address = typeof input.address === "string" ? input.address.trim() : "";
    if (!name || name.length > 100) throw new HttpError(400, "Enter your name (up to 100 characters).");
    if (!phone || phone.length > 30) throw new HttpError(400, "Enter a valid phone number.");
    if (email && (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
        throw new HttpError(400, "Enter a valid email address or leave it blank.");
    }
    if (!address || address.length > 500) throw new HttpError(400, "Enter a delivery address (up to 500 characters).");
    if (input.acceptedPrivacy !== true) throw new HttpError(400, "Please acknowledge the privacy information to place your order.");
    if (!Array.isArray(input.items) || input.items.length < 1 || input.items.length > 50) {
        throw new HttpError(400, "Your order must contain at least one product.");
    }
    const requestedItems = input.items.map((item) => {
        if (!item || typeof item.productId !== "string" || !Number.isSafeInteger(item.quantity) ||
            item.quantity < 1 || item.quantity > 99) {
            throw new HttpError(400, "One or more order quantities are invalid.");
        }
        return { productId: item.productId, quantity: item.quantity };
    });
    if (new Set(requestedItems.map((item) => item.productId)).size !== requestedItems.length) {
        throw new HttpError(400, "Each product may only appear once in the order.");
    }
    return { name, phone, email, address, requestedItems };
}

function validateAccountRegistration(input) {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
        throw new HttpError(400, "Account details are required.");
    }
    const name = typeof input.name === "string" ? input.name.trim() : "";
    const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
    const phone = typeof input.phone === "string" ? input.phone.trim() : "";
    const password = typeof input.password === "string" ? input.password : "";
    if (input.acceptedPolicies !== true) throw new HttpError(400, "Please read and accept the privacy and ordering information.");
    if (!name || name.length > 100) throw new HttpError(400, "Enter your name (up to 100 characters).");
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        throw new HttpError(400, "Enter a valid email address.");
    }
    if (!phone || phone.length > 30) throw new HttpError(400, "Enter a valid phone number.");
    if (password.length < 10 || password.length > 128) {
        throw new HttpError(400, "Choose a password between 10 and 128 characters.");
    }
    return { name, email, phone, password };
}

function readAttempt(attemptMap, address) {
    const now = Date.now();
    const current = attemptMap.get(address);
    if (!current || current.resetAt <= now) {
        const fresh = { count: 0, resetAt: now + 15 * 60 * 1000 };
        attemptMap.set(address, fresh);
        return fresh;
    }
    return current;
}

function createCustomerSession(customerId) {
    const token = randomBytes(32).toString("hex");
    const csrfToken = randomBytes(32).toString("hex");
    customerSessions.set(token, {
        customerId,
        csrfToken,
        expiresAt: Date.now() + customerSessionLifetime
    });
    const secureCookie = process.env.NODE_ENV === "production" ? "; Secure" : "";
    return {
        csrfToken,
        cookie: `${customerCookie}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${customerSessionLifetime / 1000}${secureCookie}`
    };
}

function safeCustomer(customer) {
    return { id: customer.id, name: customer.name, email: customer.email, phone: customer.phone };
}

function loginPage() {
    return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Admin sign in | L$B Interior Design</title><link rel="stylesheet" href="/style.css"></head>
<body class="admin-page"><main class="admin-login">
<a href="/" class="logo"><span>L$B</span> L$B Interior Design</a>
<p class="eyebrow">RESTRICTED AREA</p><h1>Admin sign in</h1>
<p>Sign in with the store administrator account to continue.</p>
<form id="loginForm" class="login-form">
<label for="username">Username</label><input id="username" name="username" autocomplete="username" required>
<label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password" required>
<p id="loginMessage" class="form-message" role="alert"></p>
<button type="submit" class="primary-btn">Sign in</button></form>
<a class="back-link" href="/">← Back to store</a></main><script src="/admin-login.js" defer></script></body></html>`;
}

function readLoginAttempt(address) {
    const now = Date.now();
    const current = loginAttempts.get(address);
    if (!current || current.resetAt <= now) {
        const fresh = { count: 0, resetAt: now + 15 * 60 * 1000 };
        loginAttempts.set(address, fresh);
        return fresh;
    }
    return current;
}

async function handle(request, response) {
    const url = new URL(request.url, "http://localhost");
    const pathname = url.pathname;
    const session = getSession(request);

    if (request.method === "GET" && pathname === "/") {
        return sendFile(response, path.join(root, "index.html"), "text/html; charset=utf-8");
    }
    if (request.method === "GET" && pathname === "/style.css") {
        return sendFile(response, path.join(root, "style.css"), "text/css; charset=utf-8");
    }
    if (request.method === "GET" && pathname === "/project.js") {
        return sendFile(response, path.join(root, "project.js"), "text/javascript; charset=utf-8");
    }
    if (request.method === "GET" && pathname === "/admin-login.js") {
        return sendFile(response, path.join(root, "admin-login.js"), "text/javascript; charset=utf-8");
    }
    if (request.method === "GET" && pathname === "/account.js") {
        return sendFile(response, path.join(root, "account.js"), "text/javascript; charset=utf-8");
    }
    if (request.method === "GET" && pathname === "/store-info.js") {
        return sendFile(response, path.join(root, "store-info.js"), "text/javascript; charset=utf-8");
    }
    if (request.method === "GET" && pathname === "/favicon.svg") {
        return sendFile(response, path.join(root, "favicon.svg"), "image/svg+xml");
    }
    if (request.method === "GET" && pathname === "/site.webmanifest") {
        return sendFile(response, path.join(root, "site.webmanifest"), "application/manifest+json; charset=utf-8");
    }
    if (request.method === "GET" && pathname === "/robots.txt") {
        return sendFile(response, path.join(root, "robots.txt"), "text/plain; charset=utf-8");
    }
    if (request.method === "GET" && pathname === "/policies") {
        return sendFile(response, path.join(root, "policies.html"), "text/html; charset=utf-8");
    }
    if (request.method === "GET" && pathname === "/account") {
        return sendFile(response, path.join(root, "account.html"), "text/html; charset=utf-8");
    }
    if (request.method === "GET" && pathname === "/api/store-info") {
        return sendJson(response, 200, {
            phone: process.env.STORE_PHONE || "",
            email: process.env.STORE_EMAIL || "",
            address: process.env.STORE_ADDRESS || ""
        });
    }
    if (request.method === "POST" && pathname === "/api/account/register") {
        const address = request.socket.remoteAddress || "unknown";
        const attempts = readAttempt(customerRegistrationAttempts, address);
        if (attempts.count >= 10) throw new HttpError(429, "Too many account registration attempts. Try again later.");
        attempts.count += 1;
        const account = validateAccountRegistration(await readBody(request));
        const salt = randomBytes(16).toString("hex");
        const passwordHash = scryptSync(account.password, salt, 64).toString("hex");
        const customer = {
            id: randomUUID(),
            name: account.name,
            email: account.email,
            phone: account.phone,
            passwordSalt: salt,
            passwordHash,
            acceptedPoliciesAt: new Date().toISOString(),
            createdAt: new Date().toISOString()
        };
        await mutateStore((store) => {
            if (store.customers.some((item) => item.email === customer.email)) {
                throw new HttpError(409, "An account with that email already exists. Sign in instead.");
            }
            store.customers.push(customer);
        });
        const customerSession = createCustomerSession(customer.id);
        customerRegistrationAttempts.delete(address);
        return sendJson(response, 201, {
            authenticated: true,
            csrfToken: customerSession.csrfToken,
            customer: safeCustomer(customer)
        }, { "Set-Cookie": customerSession.cookie });
    }
    if (request.method === "POST" && pathname === "/api/account/login") {
        const address = request.socket.remoteAddress || "unknown";
        const attempts = readAttempt(customerLoginAttempts, address);
        if (attempts.count >= 10) throw new HttpError(429, "Too many sign-in attempts. Try again in 15 minutes.");
        const input = await readBody(request);
        if (!input || typeof input !== "object" || Array.isArray(input)) {
            throw new HttpError(400, "Enter your email and password.");
        }
        const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
        const password = typeof input.password === "string" ? input.password.slice(0, 128) : "";
        const store = await readStore();
        const customer = store.customers.find((item) => item.email === email);
        const salt = customer ? customer.passwordSalt : randomBytes(16).toString("hex");
        const submittedHash = scryptSync(password, salt, 64);
        const expectedHash = customer ? Buffer.from(customer.passwordHash, "hex") : Buffer.alloc(64);
        const validPassword = expectedHash.length === submittedHash.length &&
            timingSafeEqual(expectedHash, submittedHash);
        if (!customer || !validPassword) {
            attempts.count += 1;
            throw new HttpError(401, "The email or password is incorrect.");
        }
        customerLoginAttempts.delete(address);
        const customerSession = createCustomerSession(customer.id);
        return sendJson(response, 200, {
            authenticated: true,
            csrfToken: customerSession.csrfToken,
            customer: safeCustomer(customer)
        }, { "Set-Cookie": customerSession.cookie });
    }
    if (request.method === "GET" && pathname === "/api/account/session") {
        const customerSession = getCustomerSession(request);
        if (!customerSession) return sendJson(response, 200, { authenticated: false });
        const store = await readStore();
        const customer = store.customers.find((item) => item.id === customerSession.customerId);
        if (!customer) throw new HttpError(401, "Please sign in to your customer account.");
        return sendJson(response, 200, {
            csrfToken: customerSession.csrfToken,
            customer: safeCustomer(customer)
        });
    }
    if (request.method === "GET" && pathname === "/api/account/orders") {
        const customerSession = requireCustomerSession(request);
        const store = await readStore();
        const orders = store.orders
            .filter((order) => order.customerId === customerSession.customerId)
            .map(({ id, status, total, createdAt, items }) => ({ id, status, total, createdAt, items }));
        return sendJson(response, 200, orders);
    }
    if (request.method === "POST" && pathname === "/api/account/logout") {
        const customerSession = requireCustomerSession(request);
        verifyCsrf(request, customerSession);
        customerSessions.delete(customerSession.token);
        const secureCookie = process.env.NODE_ENV === "production" ? "; Secure" : "";
        return sendJson(response, 200, { success: true }, {
            "Set-Cookie": `${customerCookie}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secureCookie}`
        });
    }
    if (request.method === "POST" && pathname === "/api/account/password") {
        const customerSession = requireCustomerSession(request);
        verifyCsrf(request, customerSession);
        const input = await readBody(request);
        if (!input || typeof input !== "object" || Array.isArray(input)) {
            throw new HttpError(400, "Password details are required.");
        }
        const currentPassword = typeof input.currentPassword === "string" ? input.currentPassword.slice(0, 128) : "";
        const newPassword = typeof input.newPassword === "string" ? input.newPassword : "";
        if (newPassword.length < 10 || newPassword.length > 128) {
            throw new HttpError(400, "Choose a password between 10 and 128 characters.");
        }
        await mutateStore((store) => {
            const customer = store.customers.find((item) => item.id === customerSession.customerId);
            if (!customer) throw new HttpError(401, "Please sign in to your customer account.");
            const currentHash = scryptSync(currentPassword, customer.passwordSalt, 64);
            const expectedHash = Buffer.from(customer.passwordHash, "hex");
            if (expectedHash.length !== currentHash.length || !timingSafeEqual(expectedHash, currentHash)) {
                throw new HttpError(401, "Your current password is incorrect.");
            }
            customer.passwordSalt = randomBytes(16).toString("hex");
            customer.passwordHash = scryptSync(newPassword, customer.passwordSalt, 64).toString("hex");
        });
        for (const [token, session] of customerSessions) {
            if (session.customerId === customerSession.customerId && token !== customerSession.token) {
                customerSessions.delete(token);
            }
        }
        return sendJson(response, 200, { success: true });
    }
    if (request.method === "GET" && pathname === "/admin") {
        if (!session) return send(response, 200, "text/html; charset=utf-8", loginPage());
        return sendFile(response, path.join(root, "admin.html"), "text/html; charset=utf-8");
    }
    if (request.method === "GET" && pathname === "/admin.js") {
        requireSession(request);
        return sendFile(response, path.join(root, "admin.js"), "text/javascript; charset=utf-8");
    }
    if (request.method === "GET" && pathname === "/api/session") {
        const authenticatedSession = requireSession(request);
        return sendJson(response, 200, { authenticated: true, csrfToken: authenticatedSession.csrfToken });
    }
    if (request.method === "POST" && pathname === "/api/login") {
        const address = request.socket.remoteAddress || "unknown";
        const attempts = readLoginAttempt(address);
        if (attempts.count >= 5) throw new HttpError(429, "Too many sign-in attempts. Try again in 15 minutes.");
        const input = await readBody(request);
        if (!input || typeof input !== "object" || Array.isArray(input)) {
            throw new HttpError(400, "A username and password are required.");
        }
        const submittedPassword = typeof input.password === "string" ? input.password : "";
        const submittedHash = scryptSync(submittedPassword.slice(0, 1024), passwordSalt, 64);
        const validPassword = timingSafeEqual(expectedPasswordHash, submittedHash);
        if (input.username !== adminUsername || !validPassword) {
            attempts.count += 1;
            throw new HttpError(401, "The username or password is incorrect.");
        }
        loginAttempts.delete(address);
        const token = randomBytes(32).toString("hex");
        const csrfToken = randomBytes(32).toString("hex");
        sessions.set(token, { csrfToken, expiresAt: Date.now() + sessionLifetime });
        const secureCookie = process.env.NODE_ENV === "production" ? "; Secure" : "";
        return sendJson(response, 200, { authenticated: true }, {
            "Set-Cookie": `${sessionCookie}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${sessionLifetime / 1000}${secureCookie}`
        });
    }
    if (request.method === "POST" && pathname === "/api/logout") {
        const authenticatedSession = requireSession(request);
        verifyCsrf(request, authenticatedSession);
        sessions.delete(authenticatedSession.token);
        return sendJson(response, 200, { success: true }, {
            "Set-Cookie": `${sessionCookie}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`
        });
    }
    if (request.method === "GET" && pathname === "/api/products") {
        const store = await readStore();
        return sendJson(response, 200, store.products.filter((product) => allowedCategories.has(product.category)));
    }
    const trackingMatch = pathname.match(/^\/api\/orders\/([^/]+)$/);
    if (request.method === "GET" && trackingMatch) {
        const address = request.socket.remoteAddress || "unknown";
        const now = Date.now();
        const attempts = orderAttempts.get(address);
        const window = !attempts || attempts.resetAt <= now
            ? { count: 0, resetAt: now + 15 * 60 * 1000 }
            : attempts;
        if (window.count >= 20) throw new HttpError(429, "Too many tracking attempts. Try again later.");
        window.count += 1;
        orderAttempts.set(address, window);
        let id;
        try {
            id = decodeURIComponent(trackingMatch[1]);
        } catch {
            throw new HttpError(400, "Invalid order number.");
        }
        const phone = url.searchParams.get("phone") || "";
        const normalizedPhone = phone.replace(/\D/g, "");
        if (!normalizedPhone || normalizedPhone.length < 7 || normalizedPhone.length > 20) {
            throw new HttpError(400, "Enter the phone number used for the order.");
        }
        const store = await readStore();
        const order = store.orders.find((item) =>
            item.id.toLowerCase() === id.toLowerCase() &&
            item.phone.replace(/\D/g, "") === normalizedPhone
        );
        if (!order) throw new HttpError(404, "We could not find an order matching those details.");
        return sendJson(response, 200, {
            id: order.id,
            status: order.status,
            createdAt: order.createdAt,
            total: order.total,
            items: order.items.map((item) => ({ name: item.name, quantity: item.quantity }))
        });
    }
    if (request.method === "POST" && pathname === "/api/orders") {
        const address = request.socket.remoteAddress || "unknown";
        const now = Date.now();
        const attempts = orderAttempts.get(address);
        const window = !attempts || attempts.resetAt <= now
            ? { count: 0, resetAt: now + 15 * 60 * 1000 }
            : attempts;
        if (window.count >= 20) throw new HttpError(429, "Too many order requests. Try again later.");
        window.count += 1;
        orderAttempts.set(address, window);
        const input = validateCustomer(await readBody(request));
        const order = await mutateStore((store) => {
            const items = input.requestedItems.map(({ productId, quantity }) => {
                const product = store.products.find((item) => item.id === productId);
                if (!product || !allowedCategories.has(product.category)) throw new HttpError(400, "A product in your cart is no longer available.");
                if (product.stock < quantity) throw new HttpError(409, `Not enough stock for ${product.name}.`);
                return { product, quantity };
            });
            const orderItems = items.map(({ product, quantity }) => ({
                productId: product.id,
                name: product.name,
                category: product.category,
                price: product.price,
                quantity
            }));
            const newOrder = {
                id: `MP-${randomUUID().slice(0, 8).toUpperCase()}`,
                customerId: getCustomerSession(request)?.customerId || null,
                name: input.name,
                phone: input.phone,
                email: input.email,
                address: input.address,
                acceptedPrivacyAt: new Date().toISOString(),
                items: orderItems,
                total: orderItems.reduce((sum, item) => sum + item.price * item.quantity, 0),
                status: "pending",
                createdAt: new Date().toISOString()
            };
            for (const { product, quantity } of items) product.stock -= quantity;
            store.orders.unshift(newOrder);
            return newOrder;
        });
        return sendJson(response, 201, { order: { id: order.id, total: order.total } });
    }

    if (pathname.startsWith("/api/admin/")) {
        const authenticatedSession = requireSession(request);
        if (request.method !== "GET") verifyCsrf(request, authenticatedSession);
    }

    if (request.method === "GET" && pathname === "/api/admin/products") {
        const store = await readStore();
        return sendJson(response, 200, store.products.filter((product) => allowedCategories.has(product.category)));
    }
    if (request.method === "POST" && pathname === "/api/admin/products") {
        const product = { id: randomUUID(), ...validateProduct(await readBody(request)) };
        await mutateStore((store) => store.products.push(product));
        return sendJson(response, 201, product);
    }
    const productMatch = pathname.match(/^\/api\/admin\/products\/([^/]+)$/);
    if (productMatch && ["PUT", "DELETE"].includes(request.method)) {
        let id;
        try {
            id = decodeURIComponent(productMatch[1]);
        } catch {
            throw new HttpError(400, "Invalid product id.");
        }
        if (request.method === "DELETE") {
            await mutateStore((store) => {
                const productIndex = store.products.findIndex((product) => product.id === id);
                if (productIndex === -1) throw new HttpError(404, "Product not found.");
                store.products.splice(productIndex, 1);
            });
            return sendJson(response, 200, { success: true });
        }
        const updatedProduct = { id, ...validateProduct(await readBody(request)) };
        await mutateStore((store) => {
            const productIndex = store.products.findIndex((product) => product.id === id);
            if (productIndex === -1) throw new HttpError(404, "Product not found.");
            store.products[productIndex] = updatedProduct;
        });
        return sendJson(response, 200, updatedProduct);
    }
    if (request.method === "GET" && pathname === "/api/admin/orders") {
        const store = await readStore();
        return sendJson(response, 200, store.orders);
    }
    const orderMatch = pathname.match(/^\/api\/admin\/orders\/([^/]+)$/);
    if (request.method === "PATCH" && orderMatch) {
        let id;
        try {
            id = decodeURIComponent(orderMatch[1]);
        } catch {
            throw new HttpError(400, "Invalid order id.");
        }
        const input = await readBody(request);
        if (!allowedOrderStatuses.has(input.status)) throw new HttpError(400, "Invalid order status.");
        const order = await mutateStore((store) => {
            const selectedOrder = store.orders.find((item) => item.id === id);
            if (!selectedOrder) throw new HttpError(404, "Order not found.");
            if (selectedOrder.status === "cancelled" || selectedOrder.status === "fulfilled") {
                throw new HttpError(409, "This order is already closed and cannot be changed.");
            }
            if (input.status === "cancelled") {
                for (const orderedItem of selectedOrder.items) {
                    const product = store.products.find((item) => item.id === orderedItem.productId);
                    if (product) product.stock += orderedItem.quantity;
                }
            }
            selectedOrder.status = input.status;
            return selectedOrder;
        });
        return sendJson(response, 200, order);
    }

    throw new HttpError(404, "Page not found.");
}

const server = http.createServer(async (request, response) => {
    try {
        await handle(request, response);
    } catch (error) {
        if (error instanceof HttpError) {
            sendJson(response, error.statusCode, { error: error.message });
            return;
        }
        console.error("Request failed:", error);
        sendJson(response, 500, { error: "The server could not complete the request." });
    }
});

const port = Number(process.env.PORT || 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error("PORT must be a valid port number.");
    process.exit(1);
}
ensureStoreFile().then(() => {
    server.listen(port, "0.0.0.0", () => {
        console.log(`L$B Interior Design is ready at http://localhost:${port}`);
        if (process.env.NODE_ENV !== "production") {
            console.warn("For deployment, use HTTPS and set NODE_ENV=production so admin cookies are Secure.");
        }
    });
}).catch((error) => {
    console.error("Could not restrict permissions on store-data.json:", error);
    process.exit(1);
});
