"use strict";

const productForm = document.querySelector("#productForm");
const productRows = document.querySelector("#productRows");
const orderRows = document.querySelector("#orderRows");
const productMessage = document.querySelector("#productMessage");
const orderMessage = document.querySelector("#orderAdminMessage");
let csrfToken = "";
let products = [];

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
    if (response.status === 401) {
        window.location.assign("/admin");
        throw new Error("Your session has expired. Please sign in again.");
    }
    if (!response.ok) throw new Error(result.error || "The request could not be completed.");
    return result;
}

async function loadProducts() {
    products = await request("/api/admin/products");
    productRows.innerHTML = products.map((product) => `
        <tr>
            <td><strong>${escapeHtml(product.name)}</strong><small>${escapeHtml(product.description)}</small></td>
            <td>${escapeHtml(product.category)}</td>
            <td>${formatPrice(product.price)}</td>
            <td>${product.stock}</td>
            <td class="table-actions">
                <button type="button" class="secondary-btn" data-edit="${escapeHtml(product.id)}">Edit</button>
                <button type="button" class="danger-btn" data-delete="${escapeHtml(product.id)}">Remove</button>
            </td>
        </tr>
    `).join("") || '<tr><td colspan="5">No products yet. Add a product above.</td></tr>';
}

async function loadOrders() {
    const orders = await request("/api/admin/orders");
    orderRows.innerHTML = orders.map((order) => `
        <tr>
            <td><strong>${escapeHtml(order.id)}</strong><small>${escapeHtml(new Date(order.createdAt).toLocaleString())}</small></td>
            <td>${escapeHtml(order.name)}
                <small>${escapeHtml(order.address)}</small>
                <a class="map-link" href="https://www.google.com/maps/search/?api=1&amp;query=${encodeURIComponent(order.address)}" target="_blank" rel="noopener noreferrer" aria-label="Open delivery address for order ${escapeHtml(order.id)} in Google Maps">Open in Google Maps ↗</a>
            </td>
            <td>${escapeHtml(order.phone)}${order.email ? `<small>${escapeHtml(order.email)}</small>` : ""}</td>
            <td>${order.items.map((item) => `${escapeHtml(item.name)} × ${item.quantity}`).join("<br>")}</td>
            <td>${formatPrice(order.total)}</td>
            <td>
                <select data-status="${escapeHtml(order.id)}" aria-label="Order status">
                    ${["pending", "confirmed", "fulfilled", "cancelled"].map((status) =>
                        `<option value="${status}" ${order.status === status ? "selected" : ""}>${status}</option>`
                    ).join("")}
                </select>
            </td>
        </tr>
    `).join("") || '<tr><td colspan="6">No orders have been placed.</td></tr>';
}

async function refreshDashboard() {
    try {
        await Promise.all([loadProducts(), loadOrders()]);
        orderMessage.textContent = "";
    } catch (error) {
        orderMessage.textContent = error.message;
    }
}

document.querySelector("#productForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(productForm));
    const id = values.id;
    const button = productForm.querySelector('[type="submit"]');
    button.disabled = true;
    productMessage.textContent = "Saving...";
    try {
        await request(id ? `/api/admin/products/${encodeURIComponent(id)}` : "/api/admin/products", {
            method: id ? "PUT" : "POST",
            body: JSON.stringify({
                name: values.name,
                category: values.category,
                price: Number(values.price),
                stock: Number(values.stock),
                description: values.description,
                image: values.image
            })
        });
        productForm.reset();
        productForm.elements.id.value = "";
        document.querySelector("#cancelEdit").hidden = true;
        productMessage.textContent = "Product saved.";
        await loadProducts();
    } catch (error) {
        productMessage.textContent = error.message;
    } finally {
        button.disabled = false;
    }
});

productRows.addEventListener("click", async (event) => {
    const editButton = event.target.closest("[data-edit]");
    const deleteButton = event.target.closest("[data-delete]");
    if (editButton) {
        const product = products.find((item) => item.id === editButton.dataset.edit);
        if (!product) return;
        for (const [field, value] of Object.entries(product)) {
            if (productForm.elements[field]) productForm.elements[field].value = value;
        }
        productMessage.textContent = `Editing ${product.name}.`;
        document.querySelector("#cancelEdit").hidden = false;
        productForm.scrollIntoView({ behavior: "smooth", block: "center" });
        return;
    }
    if (deleteButton && window.confirm("Remove this product from the public store?")) {
        try {
            await request(`/api/admin/products/${encodeURIComponent(deleteButton.dataset.delete)}`, { method: "DELETE" });
            productMessage.textContent = "Product removed.";
            await loadProducts();
        } catch (error) {
            productMessage.textContent = error.message;
        }
    }
});

document.querySelector("#cancelEdit").addEventListener("click", () => {
    productForm.reset();
    productForm.elements.id.value = "";
    productMessage.textContent = "";
    document.querySelector("#cancelEdit").hidden = true;
});

orderRows.addEventListener("change", async (event) => {
    const select = event.target.closest("[data-status]");
    if (!select) return;
    try {
        await request(`/api/admin/orders/${encodeURIComponent(select.dataset.status)}`, {
            method: "PATCH",
            body: JSON.stringify({ status: select.value })
        });
        orderMessage.textContent = "Order status updated.";
        await loadProducts();
    } catch (error) {
        orderMessage.textContent = error.message;
        await loadOrders();
    }
});

document.querySelector("#refreshOrders").addEventListener("click", refreshDashboard);
document.querySelector("#logoutButton").addEventListener("click", async () => {
    try {
        await request("/api/logout", { method: "POST" });
        window.location.assign("/");
    } catch (error) {
        orderMessage.textContent = error.message;
    }
});

async function startAdmin() {
    try {
        const session = await request("/api/session");
        csrfToken = session.csrfToken;
        await refreshDashboard();
    } catch (error) {
        orderMessage.textContent = error.message;
    }
}

startAdmin();
