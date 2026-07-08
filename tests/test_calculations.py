import unittest

from calculations import VoyageInputs, compute_metrics


class CalculationsTests(unittest.TestCase):
    def test_compute_metrics_nominal_case(self):
        result = compute_metrics(
            VoyageInputs(
                distance_nm=1200,
                steaming_hours=96,
                me_power_kw=8200,
                me_mcr_kw=12000,
                me_rpm=88,
                propeller_pitch_m=6.2,
                fuel_hfo_mt=72,
                fuel_mgo_mt=5,
                cargo_mt=25500,
            )
        )

        self.assertAlmostEqual(result.total_fuel_mt, 77.0, places=3)
        self.assertAlmostEqual(result.fuel_per_day_mt, 19.25, places=2)
        self.assertAlmostEqual(result.avg_speed_kn, 12.5, places=3)
        self.assertGreater(result.sfoc_g_kwh, 0)
        self.assertGreater(result.eeoi_g_co2_per_tnm, 0)

    def test_compute_metrics_handles_zero_denominators(self):
        result = compute_metrics(
            VoyageInputs(
                distance_nm=0,
                steaming_hours=0,
                me_power_kw=0,
                me_mcr_kw=0,
                me_rpm=0,
                propeller_pitch_m=0,
                fuel_hfo_mt=0,
                fuel_mgo_mt=0,
                cargo_mt=0,
            )
        )

        self.assertEqual(result.fuel_per_day_mt, 0.0)
        self.assertEqual(result.fuel_per_nm_mt, 0.0)
        self.assertEqual(result.sfoc_g_kwh, 0.0)
        self.assertEqual(result.eeoi_g_co2_per_tnm, 0.0)


if __name__ == "__main__":
    unittest.main()
