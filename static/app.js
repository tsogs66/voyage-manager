const form = document.getElementById("voyage-form");
const formMessage = document.getElementById("form-message");
const tableBody = document.getElementById("voyage-table-body");

function toPayload(formElement) {
  const formData = new FormData(formElement);
  const payload = {};
  for (const [key, value] of formData.entries()) {
    payload[key] = value;
  }
  return payload;
}

function fmt(value, digits = 2) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return "-";
  }
  return number.toFixed(digits);
}

async function loadVoyages() {
  const response = await fetch("/api/voyages");
  const voyages = await response.json();

  tableBody.innerHTML = "";
  voyages.forEach((v) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${v.id}</td>
      <td>${v.report_date}</td>
      <td>${v.vessel_name}</td>
      <td>${v.voyage_no}</td>
      <td>${v.departure_port} → ${v.arrival_port}</td>
      <td>${fmt(v.fuel_per_day_mt, 3)}</td>
      <td>${fmt(v.sfoc_g_kwh, 2)}</td>
      <td>${fmt(v.avg_speed_kn, 2)}</td>
      <td>${fmt(v.engine_load_factor_pct, 1)}</td>
      <td>${fmt(v.eeoi_g_co2_per_tnm, 3)}</td>
      <td><button data-id="${v.id}" class="danger">Delete</button></td>
    `;
    tableBody.appendChild(tr);
  });
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  formMessage.textContent = "";

  const response = await fetch("/api/voyages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(toPayload(form)),
  });

  const data = await response.json();
  if (!response.ok) {
    formMessage.textContent = data.error || "Failed to save report.";
    formMessage.classList.add("error");
    return;
  }

  form.reset();
  formMessage.textContent = "Report saved and metrics calculated.";
  formMessage.classList.remove("error");
  await loadVoyages();
});

tableBody.addEventListener("click", async (event) => {
  const target = event.target;
  if (!(target instanceof HTMLButtonElement)) {
    return;
  }

  const id = target.dataset.id;
  if (!id) {
    return;
  }

  const ok = window.confirm(`Delete voyage report #${id}?`);
  if (!ok) {
    return;
  }

  const response = await fetch(`/api/voyages/${id}`, { method: "DELETE" });
  if (response.ok) {
    await loadVoyages();
  }
});

loadVoyages();
