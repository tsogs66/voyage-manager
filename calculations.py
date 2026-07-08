from __future__ import annotations

from dataclasses import dataclass, asdict


@dataclass
class VoyageInputs:
    distance_nm: float
    steaming_hours: float
    me_power_kw: float
    me_mcr_kw: float
    me_rpm: float
    propeller_pitch_m: float
    fuel_hfo_mt: float
    fuel_mgo_mt: float
    cargo_mt: float


@dataclass
class VoyageMetrics:
    total_fuel_mt: float
    fuel_per_day_mt: float
    fuel_per_nm_mt: float
    avg_speed_kn: float
    sfoc_g_kwh: float
    engine_load_factor_pct: float
    propeller_slip_pct: float
    transport_work_tnm: float
    co2_emissions_t: float
    eeoi_g_co2_per_tnm: float

    def to_dict(self) -> dict:
        return asdict(self)


def _safe_div(numerator: float, denominator: float) -> float:
    if denominator == 0:
        return 0.0
    return numerator / denominator


def compute_metrics(payload: VoyageInputs) -> VoyageMetrics:
    total_fuel_mt = payload.fuel_hfo_mt + payload.fuel_mgo_mt
    steaming_days = _safe_div(payload.steaming_hours, 24.0)

    fuel_per_day_mt = _safe_div(total_fuel_mt, steaming_days)
    fuel_per_nm_mt = _safe_div(total_fuel_mt, payload.distance_nm)
    avg_speed_kn = _safe_div(payload.distance_nm, payload.steaming_hours)

    produced_energy_kwh = payload.me_power_kw * payload.steaming_hours
    sfoc_g_kwh = _safe_div(total_fuel_mt * 1_000_000.0, produced_energy_kwh)

    engine_load_factor_pct = _safe_div(payload.me_power_kw, payload.me_mcr_kw) * 100.0

    theoretical_speed_kn = _safe_div(
        payload.me_rpm * 60.0 * payload.propeller_pitch_m, 1852.0
    )
    propeller_slip_pct = (1.0 - _safe_div(avg_speed_kn, theoretical_speed_kn)) * 100.0

    transport_work_tnm = payload.cargo_mt * payload.distance_nm

    # IMO-like fuel to CO2 factors (tCO2/tFuel), simplified for HFO/MGO split.
    co2_emissions_t = (payload.fuel_hfo_mt * 3.114) + (payload.fuel_mgo_mt * 3.206)
    eeoi_g_co2_per_tnm = _safe_div(co2_emissions_t * 1_000_000.0, transport_work_tnm)

    return VoyageMetrics(
        total_fuel_mt=round(total_fuel_mt, 4),
        fuel_per_day_mt=round(fuel_per_day_mt, 4),
        fuel_per_nm_mt=round(fuel_per_nm_mt, 6),
        avg_speed_kn=round(avg_speed_kn, 4),
        sfoc_g_kwh=round(sfoc_g_kwh, 4),
        engine_load_factor_pct=round(engine_load_factor_pct, 4),
        propeller_slip_pct=round(propeller_slip_pct, 4),
        transport_work_tnm=round(transport_work_tnm, 2),
        co2_emissions_t=round(co2_emissions_t, 4),
        eeoi_g_co2_per_tnm=round(eeoi_g_co2_per_tnm, 4),
    )
