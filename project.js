"use strict";

const productsElement = document.querySelector("#products");
const storeMessage = document.querySelector("#storeMessage");
const categoryFilter = document.querySelector("#categoryFilter");
const searchOverlay = document.querySelector("#searchOverlay");
const cartOverlay = document.querySelector("#cartOverlay");
const orderOverlay = document.querySelector("#orderOverlay");
const cartContents = document.querySelector("#cartContents");
const cartMessage = document.querySelector("#cartMessage");
const cartTotal = document.querySelector("#cartTotal");
const checkoutButton = document.querySelector("#checkoutButton");
const trackingForm = document.querySelector("#trackingForm");
const trackingMessage = document.querySelector("#trackingMessage");
const confirmation = document.querySelector("#orderConfirmation");

let products = [];
let cart = loadCart();

function loadCart() {
    try {
        const saved = JSON.parse(localStorage.getItem("momPopCart") || "{}");
        return saved && typeof saved === "object" && !Array.isArray(saved) ? saved : {};
    } catch (error) {
        console.error("Could not read the saved cart.", error);
        return {};
    }
}

function saveCart() {
    localStorage.setItem("momPopCart", JSON.stringify(cart));
}

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
            ...options.headers
        }
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(result.error || "The request could not be completed.");
    }
    return result;
}

function visibleProducts() {
    const selectedCategory = categoryFilter.value;
    const query = document.querySelector("#searchInput").value.trim().toLowerCase();
    return products.filter((product) => {
        const matchesCategory = selectedCategory === "all" || product.category === selectedCategory;
        const matchesSearch = `${product.name} ${product.category} ${product.description}`
            .toLowerCase().includes(query);
        return matchesCategory && matchesSearch;
    });
}

function renderProducts() {
    const filteredProducts = visibleProducts();
    productsElement.innerHTML = filteredProducts.map((product) => {
        return `
            <article class="product-card">
                <div class="product-image product-placeholder">
                    ${product.image ? `<img src="${escapeHtml(product.image)}" alt="${escapeHtml(product.name)}">` : ""}
                    <span class="badge">${escapeHtml(product.category)}</span>
                </div>
                <div class="product-info">
                    <p>${escapeHtml(product.category)} · ${product.stock} in stock</p>
                    <h3>${escapeHtml(product.name)}</h3>
                    <p class="product-description">${escapeHtml(product.description)}</p>
                    <div class="product-bottom">
                        <strong>${formatPrice(product.price)}</strong>
                        <button type="button" data-add="${escapeHtml(product.id)}" ${product.stock < 1 ? "disabled" : ""}>
                            ${product.stock < 1 ? "Sold out" : "+ Add"}
                        </button>
                    </div>
                </div>
            </article>
        `;
    }).join("");
    storeMessage.textContent = filteredProducts.length ? "" : "No matching products found.";
}

function renderCart() {
    const lines = Object.entries(cart)
        .map(([id, quantity]) => ({ product: products.find((item) => item.id === id), quantity }))
        .filter((line) => line.product && Number.isInteger(line.quantity) && line.quantity > 0);
    cart = Object.fromEntries(lines.map(({ product, quantity }) => [product.id, quantity]));
    const count = lines.reduce((total, line) => total + line.quantity, 0);
    const total = lines.reduce((sum, line) => sum + line.product.price * line.quantity, 0);
    document.querySelector("#cartCount").textContent = String(count);
    cartContents.innerHTML = lines.map(({ product, quantity }) => `
        <div class="cart-line">
            <div>
                <strong>${escapeHtml(product.name)}</strong>
                <small>${formatPrice(product.price)} each</small>
            </div>
            <div class="cart-quantity">
                <button type="button" data-quantity="${escapeHtml(product.id)}" data-change="-1" aria-label="Remove one">−</button>
                <span>${quantity}</span>
                <button type="button" data-quantity="${escapeHtml(product.id)}" data-change="1" aria-label="Add one" ${quantity >= product.stock ? "disabled" : ""}>+</button>
            </div>
        </div>
    `).join("");
    cartTotal.textContent = lines.length ? `Total: ${formatPrice(total)}` : "";
    cartMessage.textContent = lines.length ? "" : "Your cart is currently empty.";
    checkoutButton.disabled = lines.length === 0;
    saveCart();
}

async function loadProducts() {
    try {
        products = await request("/api/products");
        renderProducts();
        renderCart();
    } catch (error) {
        storeMessage.textContent = error.message;
    }
}

function showOverlay(overlay) {
    overlay.style.display = "grid";
    document.body.classList.add("modal-open");
}

function hideOverlay(overlay) {
    overlay.style.display = "none";
    if (![searchOverlay, cartOverlay, orderOverlay].some((item) => item.style.display === "grid")) {
        document.body.classList.remove("modal-open");
    }
}

document.querySelector("#openSearch").addEventListener("click", () => showOverlay(searchOverlay));
document.querySelector("#openCart").addEventListener("click", () => {
    renderCart();
    showOverlay(cartOverlay);
});
document.querySelector("#menuToggle").addEventListener("click", (event) => {
    const menu = document.querySelector("#mobileMenu");
    const expanded = menu.classList.toggle("active");
    event.currentTarget.setAttribute("aria-expanded", String(expanded));
});
document.querySelector("#mobileMenu").addEventListener("click", (event) => {
    if (!event.target.closest("a")) return;
    document.querySelector("#mobileMenu").classList.remove("active");
    document.querySelector("#menuToggle").setAttribute("aria-expanded", "false");
});
document.querySelector("#categories").addEventListener("click", (event) => {
    const categoryLink = event.target.closest("[data-category]");
    if (!categoryLink) return;
    categoryFilter.value = categoryLink.dataset.category;
    renderProducts();
});
document.querySelectorAll(".overlay").forEach((overlay) => {
    overlay.addEventListener("click", (event) => {
        if (event.target === overlay) hideOverlay(overlay);
    });
});
document.querySelectorAll(".close").forEach((button) => {
    button.addEventListener("click", () => hideOverlay(button.closest(".overlay")));
});
document.querySelector("#searchSubmit").addEventListener("click", () => {
    renderProducts();
    hideOverlay(searchOverlay);
    document.querySelector("#shop").scrollIntoView({ behavior: "smooth" });
});
document.querySelector("#searchInput").addEventListener("keydown", (event) => {
    if (event.key === "Enter") document.querySelector("#searchSubmit").click();
});
categoryFilter.addEventListener("change", renderProducts);
productsElement.addEventListener("click", (event) => {
    const button = event.target.closest("[data-add]");
    if (!button) return;
    const product = products.find((item) => item.id === button.dataset.add);
    if (!product) return;
    const quantity = cart[product.id] || 0;
    if (quantity >= product.stock) {
        storeMessage.textContent = "There is not enough stock to add another item.";
        return;
    }
    cart[product.id] = quantity + 1;
    renderCart();
    storeMessage.textContent = `${product.name} added to your cart.`;
});
cartContents.addEventListener("click", (event) => {
    const button = event.target.closest("[data-quantity]");
    if (!button) return;
    const id = button.dataset.quantity;
    const nextQuantity = (cart[id] || 0) + Number(button.dataset.change);
    if (nextQuantity <= 0) delete cart[id];
    else cart[id] = nextQuantity;
    renderCart();
});
checkoutButton.addEventListener("click", () => {
    hideOverlay(cartOverlay);
    showOverlay(orderOverlay);
    request("/api/account/session").then(({ customer }) => {
        if (!customer) return;
        const fields = {
            customerName: customer.name,
            customerPhone: customer.phone,
            customerEmail: customer.email
        };
        for (const [id, value] of Object.entries(fields)) {
            const field = document.getElementById(id);
            if (!field.value) field.value = value;
        }
    }).catch(() => {});
});
document.querySelector("[data-close-order]").addEventListener("click", () => hideOverlay(orderOverlay));
document.querySelector("#orderForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const message = document.querySelector("#orderMessage");
    const form = event.currentTarget;
    const submitButton = form.querySelector('[type="submit"]');
    submitButton.disabled = true;
    message.textContent = "Submitting your order...";
    try {
        const values = new FormData(form);
        const result = await request("/api/orders", {
            method: "POST",
            body: JSON.stringify({
                name: values.get("name"),
                phone: values.get("phone"),
                email: values.get("email"),
                address: values.get("address"),
                acceptedPrivacy: document.querySelector("#acceptedPrivacy").checked,
                items: Object.entries(cart).map(([id, quantity]) => ({ productId: id, quantity }))
            })
        });
        cart = {};
        await loadProducts();
        form.reset();
        hideOverlay(orderOverlay);
        document.querySelector("#confirmationNumber").textContent = result.order.id;
        confirmation.showModal();
    } catch (error) {
        message.textContent = error.message;
    } finally {
        submitButton.disabled = false;
    }
});

trackingForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const values = new FormData(trackingForm);
    const submitButton = trackingForm.querySelector('[type="submit"]');
    submitButton.disabled = true;
    trackingMessage.textContent = "Checking order...";
    try {
        const orderId = encodeURIComponent(String(values.get("orderId")).trim());
        const phone = encodeURIComponent(String(values.get("phone")).trim());
        const order = await request(`/api/orders/${orderId}?phone=${phone}`);
        const items = order.items.map((item) => `${item.name} × ${item.quantity}`).join(", ");
        trackingMessage.textContent = `${order.id} · ${order.status} · ${formatPrice(order.total)} · ${items}`;
    } catch (error) {
        trackingMessage.textContent = error.message;
    } finally {
        submitButton.disabled = false;
    }
});

document.querySelector("#closeConfirmation").addEventListener("click", () => confirmation.close());
document.querySelector("#confirmationDone").addEventListener("click", () => confirmation.close());

document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
        [searchOverlay, cartOverlay, orderOverlay].forEach((overlay) => hideOverlay(overlay));
    }
});

document.querySelector("#currentYear").textContent = String(new Date().getFullYear());
loadProducts();
