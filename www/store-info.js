"use strict";

async function loadStoreContact() {
    try {
        const response = await fetch("/api/store-info");
        if (!response.ok) throw new Error("Store contact information could not be loaded.");
        const info = await response.json();
        const targets = [
            document.querySelector("#storeContact"),
            document.querySelector("#policyContact")
        ].filter(Boolean);
        const details = [];
        if (info.phone) details.push(`<a href="tel:${encodeURIComponent(info.phone)}">${escapeHtml(info.phone)}</a>`);
        if (info.email) details.push(`<a href="mailto:${encodeURIComponent(info.email)}">${escapeHtml(info.email)}</a>`);
        if (info.address) details.push(`<span>${escapeHtml(info.address)}</span>`);
        const content = details.length ? details.join(" · ") : "Store contact details are not configured yet.";
        for (const target of targets) target.innerHTML = content;
    } catch (error) {
        console.error(error);
    }
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

loadStoreContact();
