// 어흥이's weather pill: Open-Meteo's forecast and air quality, no key and no
// account. The island asks every half hour; only the place's coordinates leave
// the computer. The page turns the numbers into words (src/study/weather.ts).

use std::time::Duration;

use serde_json::{json, Value};

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|e| e.to_string())
}

async fn get(url: &str) -> Result<Value, String> {
    let response = client()?
        .get(url)
        .send()
        .await
        .map_err(|_| "날씨 서버에 연결하지 못했어.".to_string())?;
    if !response.status().is_success() {
        return Err(format!("날씨 서버 오류 ({})", response.status().as_u16()));
    }
    let bytes = crate::net::read_capped(response, 1024 * 1024).await?;
    serde_json::from_slice(&bytes).map_err(|_| "날씨 응답을 읽지 못했어.".to_string())
}

fn valid(lat: f64, lon: f64) -> Result<(), String> {
    if lat.is_finite() && lon.is_finite() && lat.abs() <= 90.0 && lon.abs() <= 180.0 {
        Ok(())
    } else {
        Err("위치가 올바르지 않아.".into())
    }
}

/// The forecast (now, the next 24 hours, today) and the air (PM10, PM2.5) for one place.
#[tauri::command]
pub async fn weather_get(lat: f64, lon: f64) -> Result<Value, String> {
    valid(lat, lon)?;
    let forecast = format!(
        "https://api.open-meteo.com/v1/forecast?latitude={lat:.4}&longitude={lon:.4}\
         &current=temperature_2m,apparent_temperature,weather_code,is_day,precipitation\
         &hourly=temperature_2m,precipitation_probability,precipitation,weather_code\
         &daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code,sunset\
         &forecast_days=2&timezone=auto"
    );
    let air = format!(
        "https://air-quality-api.open-meteo.com/v1/air-quality?latitude={lat:.4}&longitude={lon:.4}\
         &current=pm10,pm2_5&timezone=auto"
    );
    let (f, a) = tokio::join!(get(&forecast), get(&air));
    // The air is a bonus: the weather still shows when only it fails.
    Ok(json!({ "forecast": f?, "air": a.ok() }))
}

/// Places matching `name` (Korean names work: "고양", "경주").
#[tauri::command]
pub async fn weather_search(name: String) -> Result<Value, String> {
    let name: String = name.trim().chars().take(60).collect();
    if name.is_empty() {
        return Ok(json!([]));
    }
    let mut url = reqwest::Url::parse("https://geocoding-api.open-meteo.com/v1/search").map_err(|e| e.to_string())?;
    url.query_pairs_mut()
        .append_pair("name", &name)
        .append_pair("count", "8")
        .append_pair("language", "ko")
        .append_pair("format", "json");
    let v = get(url.as_str()).await?;
    let list = v
        .get("results")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .map(|r| {
            json!({
                "name": r.get("name"),
                "admin": r.get("admin1"),
                "country": r.get("country"),
                "lat": r.get("latitude"),
                "lon": r.get("longitude"),
            })
        })
        .collect::<Vec<_>>();
    Ok(Value::Array(list))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn coordinates_are_checked() {
        assert!(valid(37.6, 126.8).is_ok());
        assert!(valid(91.0, 0.0).is_err());
        assert!(valid(f64::NAN, 0.0).is_err());
    }
}
