const DATA_URL = "https://gml.noaa.gov/webdata/ccgg/trends/co2/co2_mm_mlo.txt";
const SEASON_LENGTH = 12;
const FORECAST_HORIZON = 6;
const PREDICTION_Z = 1.96;

const statusText = document.getElementById("status-text");
const refreshButton = document.getElementById("refresh-button");
const latestValue = document.getElementById("latest-value");
const latestDate = document.getElementById("latest-date");
const nextForecastValue = document.getElementById("next-forecast-value");
const nextForecastDate = document.getElementById("next-forecast-date");
const forecastTableBody = document.getElementById("forecast-table-body");
const chartCanvas = document.getElementById("co2-chart");
const chartContext = chartCanvas.getContext("2d");

const monthFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  year: "numeric"
});

let latestChartState = null;
let resizeTimer = null;

function toMonthDate(year, month) {
  return new Date(Date.UTC(year, month - 1, 1));
}

function formatPpm(value) {
  return `${value.toFixed(2)} ppm`;
}

function parseNoaaMonthlyData(rawText) {
  return rawText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => line.split(/\s+/))
    .map((parts) => ({
      year: Number(parts[0]),
      month: Number(parts[1]),
      average: Number(parts[3])
    }))
    .filter((entry) => Number.isFinite(entry.average) && entry.average > 0)
    .map((entry) => ({
      ...entry,
      date: toMonthDate(entry.year, entry.month)
    }));
}

function initialSeasonals(series, seasonLength) {
  const seasonCount = Math.floor(series.length / seasonLength);
  const seasonAverages = [];

  for (let season = 0; season < seasonCount; season += 1) {
    const start = season * seasonLength;
    const slice = series.slice(start, start + seasonLength);
    seasonAverages.push(slice.reduce((sum, value) => sum + value, 0) / slice.length);
  }

  return Array.from({ length: seasonLength }, (_, monthIndex) => {
    let total = 0;
    for (let season = 0; season < seasonCount; season += 1) {
      total += series[season * seasonLength + monthIndex] - seasonAverages[season];
    }
    return total / seasonCount;
  });
}

function holtWintersAdditive(series, seasonLength, alpha, beta, gamma, forecastHorizon) {
  if (series.length < seasonLength * 2) {
    throw new Error("At least two seasonal cycles are required for Holt-Winters forecasting.");
  }

  const seasonals = initialSeasonals(series, seasonLength).slice();
  let level = series[0];
  let trend = (series[seasonLength] - series[0]) / seasonLength;
  let sse = 0;
  const fitted = Array(series.length).fill(null);
  const residuals = [];

  for (let index = 0; index < series.length; index += 1) {
    const observed = series[index];
    const seasonal = seasonals[index % seasonLength];

    if (index === 0) {
      fitted[index] = observed;
      continue;
    }

    const prediction = level + trend + seasonal;
    fitted[index] = prediction;
    const previousLevel = level;
    level = alpha * (observed - seasonal) + (1 - alpha) * (level + trend);
    trend = beta * (level - previousLevel) + (1 - beta) * trend;
    seasonals[index % seasonLength] = gamma * (observed - level) + (1 - gamma) * seasonal;

    const error = observed - prediction;
    residuals.push(error);
    sse += error * error;
  }

  const forecast = Array.from({ length: forecastHorizon }, (_, offset) => {
    const step = offset + 1;
    return level + step * trend + seasonals[(series.length + offset) % seasonLength];
  });

  return { fitted, forecast, residuals, sse, alpha, beta, gamma };
}

function optimizeHoltWinters(series, seasonLength, forecastHorizon) {
  const candidates = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9];
  let bestModel = null;

  for (const alpha of candidates) {
    for (const beta of candidates) {
      for (const gamma of candidates) {
        const model = holtWintersAdditive(series, seasonLength, alpha, beta, gamma, forecastHorizon);
        if (!bestModel || model.sse < bestModel.sse) {
          bestModel = model;
        }
      }
    }
  }

  return bestModel;
}

function calculateResidualSigma(residuals) {
  const degreesOfFreedom = Math.max(1, residuals.length - 3);
  const squaredError = residuals.reduce((sum, residual) => sum + residual * residual, 0);
  return Math.sqrt(squaredError / degreesOfFreedom);
}

function addMonths(date, months) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
}

function buildForecastRows(lastObservedDate, forecastValues, residualSigma) {
  return forecastValues.map((value, index) => {
    const horizon = index + 1;
    const standardError = residualSigma * Math.sqrt(horizon);
    const margin = PREDICTION_Z * standardError;

    return {
      date: addMonths(lastObservedDate, horizon),
      value,
      lower: value - margin,
      upper: value + margin
    };
  });
}

function updateSummaryCards(observations, forecastRows) {
  const latest = observations[observations.length - 1];
  const nextForecast = forecastRows[0];

  latestValue.textContent = formatPpm(latest.average);
  latestDate.textContent = monthFormatter.format(latest.date);
  nextForecastValue.textContent = `${formatPpm(nextForecast.value)} (${nextForecast.lower.toFixed(2)} to ${nextForecast.upper.toFixed(2)})`;
  nextForecastDate.textContent = `${monthFormatter.format(nextForecast.date)} 95% interval`;
}

function renderForecastTable(forecastRows) {
  forecastTableBody.innerHTML = "";
  for (const row of forecastRows) {
    const tr = document.createElement("tr");
    const monthTd = document.createElement("td");
    const valueTd = document.createElement("td");
    const lowerTd = document.createElement("td");
    const upperTd = document.createElement("td");
    monthTd.textContent = monthFormatter.format(row.date);
    valueTd.textContent = row.value.toFixed(2);
    lowerTd.textContent = row.lower.toFixed(2);
    upperTd.textContent = row.upper.toFixed(2);
    tr.append(monthTd, valueTd, lowerTd, upperTd);
    forecastTableBody.appendChild(tr);
  }
}

function drawSeries(ctx, points, color, lineWidth, dash = []) {
  ctx.beginPath();
  ctx.setLineDash(dash);
  ctx.lineWidth = lineWidth;
  ctx.strokeStyle = color;
  let started = false;

  for (const point of points) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      continue;
    }
    if (!started) {
      ctx.moveTo(point.x, point.y);
      started = true;
    } else {
      ctx.lineTo(point.x, point.y);
    }
  }

  ctx.stroke();
  ctx.setLineDash([]);
}

function fillIntervalBand(ctx, points, fillStyle) {
  if (points.length < 2) {
    return;
  }

  ctx.beginPath();
  points.forEach((point, index) => {
    if (index === 0) {
      ctx.moveTo(point.x, point.upperY);
    } else {
      ctx.lineTo(point.x, point.upperY);
    }
  });

  for (let index = points.length - 1; index >= 0; index -= 1) {
    ctx.lineTo(points[index].x, points[index].lowerY);
  }

  ctx.closePath();
  ctx.fillStyle = fillStyle;
  ctx.fill();
}

function renderChart(observations, fittedValues, forecastRows) {
  const dpr = window.devicePixelRatio || 1;
  const rect = chartCanvas.getBoundingClientRect();
  const width = Math.max(640, Math.round(rect.width || chartCanvas.width));
  const height = Math.round((width * 620) / 1280);
  chartCanvas.width = width * dpr;
  chartCanvas.height = height * dpr;
  chartCanvas.style.height = `${height}px`;
  chartContext.setTransform(dpr, 0, 0, dpr, 0, 0);

  const margin = { top: 28, right: 28, bottom: 46, left: 64 };
  const allDates = observations.map((item) => item.date).concat(forecastRows.map((item) => item.date));
  const allValues = observations.map((item) => item.average)
    .concat(fittedValues.filter((value) => Number.isFinite(value)))
    .concat(forecastRows.flatMap((item) => [item.value, item.lower, item.upper]));

  const minTime = allDates[0].getTime();
  const maxTime = allDates[allDates.length - 1].getTime();
  const minValue = Math.min(...allValues);
  const maxValue = Math.max(...allValues);
  const yPadding = (maxValue - minValue) * 0.08 || 1;
  const yMin = minValue - yPadding;
  const yMax = maxValue + yPadding;

  const xScale = (date) =>
    margin.left + ((date.getTime() - minTime) / (maxTime - minTime)) * (width - margin.left - margin.right);
  const yScale = (value) =>
    height - margin.bottom - ((value - yMin) / (yMax - yMin)) * (height - margin.top - margin.bottom);

  chartContext.clearRect(0, 0, width, height);
  chartContext.fillStyle = "rgba(255, 255, 255, 0.8)";
  chartContext.fillRect(0, 0, width, height);

  chartContext.strokeStyle = "rgba(29, 43, 53, 0.12)";
  chartContext.lineWidth = 1;
  chartContext.font = '12px "Space Grotesk", sans-serif';
  chartContext.fillStyle = "#556776";

  const yTicks = 6;
  for (let index = 0; index <= yTicks; index += 1) {
    const value = yMin + ((yMax - yMin) * index) / yTicks;
    const y = yScale(value);
    chartContext.beginPath();
    chartContext.moveTo(margin.left, y);
    chartContext.lineTo(width - margin.right, y);
    chartContext.stroke();
    chartContext.fillText(value.toFixed(0), 16, y + 4);
  }

  const startYear = observations[0].date.getUTCFullYear();
  const endYear = forecastRows[forecastRows.length - 1].date.getUTCFullYear();
  const totalYears = Math.max(1, endYear - startYear);
  const yearStep = Math.max(5, Math.ceil(totalYears / 10 / 5) * 5);
  for (let year = startYear; year <= endYear; year += yearStep) {
    const date = new Date(Date.UTC(year, 0, 1));
    const x = xScale(date);
    chartContext.beginPath();
    chartContext.moveTo(x, margin.top);
    chartContext.lineTo(x, height - margin.bottom);
    chartContext.stroke();
    chartContext.fillText(String(year), x - 12, height - 16);
  }

  const intervalBandPoints = forecastRows.map((item) => ({
    x: xScale(item.date),
    upperY: yScale(item.upper),
    lowerY: yScale(item.lower)
  }));
  fillIntervalBand(chartContext, intervalBandPoints, "rgba(217, 130, 43, 0.2)");

  drawSeries(
    chartContext,
    observations.map((item) => ({ x: xScale(item.date), y: yScale(item.average) })),
    "#0d6e8a",
    2.5
  );

  drawSeries(
    chartContext,
    observations.map((item, index) => ({
      x: xScale(item.date),
      y: Number.isFinite(fittedValues[index]) ? yScale(fittedValues[index]) : NaN
    })),
    "#4d7c93",
    1.6,
    [5, 4]
  );

  const connectorStart = observations[observations.length - 1];
  const forecastPoints = [connectorStart, ...forecastRows];
  drawSeries(
    chartContext,
    forecastPoints.map((item) => ({
      x: xScale(item.date),
      y: yScale(item.average ?? item.value)
    })),
    "#d9822b",
    2.6
  );

  chartContext.fillStyle = "#1d2b35";
  chartContext.font = '600 13px "Space Grotesk", sans-serif';
  chartContext.fillText("CO2 concentration (ppm)", margin.left, 18);
}

async function refreshData() {
  refreshButton.disabled = true;
  statusText.textContent = "Refreshing NOAA monthly CO2 data...";

  try {
    const cacheBuster = `ts=${Date.now()}`;
    const response = await fetch(`${DATA_URL}?${cacheBuster}`, {
      cache: "no-store"
    });

    if (!response.ok) {
      throw new Error(`NOAA request failed with status ${response.status}.`);
    }

    const rawText = await response.text();
    const observations = parseNoaaMonthlyData(rawText);

    if (observations.length < SEASON_LENGTH * 2) {
      throw new Error("Not enough monthly observations were returned to fit the model.");
    }

    const model = optimizeHoltWinters(
      observations.map((item) => item.average),
      SEASON_LENGTH,
      FORECAST_HORIZON
    );

    const residualSigma = calculateResidualSigma(model.residuals);
    const forecastRows = buildForecastRows(
      observations[observations.length - 1].date,
      model.forecast,
      residualSigma
    );

    latestChartState = {
      observations,
      fittedValues: model.fitted,
      forecastRows
    };

    updateSummaryCards(observations, forecastRows);
    renderForecastTable(forecastRows);
    renderChart(observations, model.fitted, forecastRows);

    statusText.textContent = `Loaded ${observations.length} monthly observations through ${monthFormatter.format(observations[observations.length - 1].date)}. Forecast parameters: alpha ${model.alpha.toFixed(1)}, beta ${model.beta.toFixed(1)}, gamma ${model.gamma.toFixed(1)}. Intervals shown are approximate 95% prediction bounds.`;
  } catch (error) {
    statusText.textContent = `Unable to refresh data: ${error.message}`;
  } finally {
    refreshButton.disabled = false;
  }
}

refreshButton.addEventListener("click", refreshData);
window.addEventListener("resize", () => {
  if (!latestChartState) {
    return;
  }

  window.clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(() => {
    renderChart(
      latestChartState.observations,
      latestChartState.fittedValues,
      latestChartState.forecastRows
    );
  }, 120);
});

refreshData();
