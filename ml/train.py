"""Fit a per-item sales regression; JSON in/out, never deserialize uploaded code.

Daily collected fraction is observed sales, NOT uncensored demand. Evaluate on
the latest dates before refitting. Export portable coefficients for Node inference.
"""
import datetime as dt
import json
import math
import sys

import numpy as np
from sklearn.linear_model import Ridge
from sklearn.metrics import mean_absolute_error
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

FEATURES = ['price_ratio', 'log_quantity', 'duration_hours', 'weekday_sin', 'weekday_cos']


def features(row):
    start = sum(int(n) * factor for n, factor in zip(row['offer_start_time'][:5].split(':'), [60, 1]))
    end = sum(int(n) * factor for n, factor in zip(row['offer_end_time'][:5].split(':'), [60, 1]))
    weekday = dt.date.fromisoformat(row['offer_date']).weekday()
    return [float(row['rescue_unit_price']) / float(row['original_unit_price']),
            math.log1p(int(row['initial_quantity'])), ((end - start) % 1440 or 1440) / 60,
            math.sin(2 * math.pi * weekday / 7), math.cos(2 * math.pi * weekday / 7)]


def train(rows):
    rows = sorted([r for r in rows if int(r['initial_quantity']) > 0 and float(r['original_unit_price']) > 0],
                  key=lambda r: r['offer_date'])
    if len(rows) < 30 or len({r['offer_date'] for r in rows}) < 30:
        raise ValueError('At least 30 eligible offer dates with positive stock and original price are required.')
    if len({round(float(r['rescue_unit_price']) / float(r['original_unit_price']), 2) for r in rows}) < 3:
        raise ValueError('History needs at least three distinct price ratios to learn a price response.')
    x = np.asarray([features(r) for r in rows])
    y = np.asarray([int(r['collected_quantity']) / int(r['initial_quantity']) for r in rows])
    split = int(len(rows) * .8)
    pipeline = make_pipeline(StandardScaler(), Ridge(alpha=10.0))
    pipeline.fit(x[:split], y[:split])
    prediction = np.clip(pipeline.predict(x[split:]), 0, 1)
    quantity = np.asarray([int(r['initial_quantity']) for r in rows[split:]])
    mae = float(mean_absolute_error(y[split:] * quantity, prediction * quantity))
    baseline = float(mean_absolute_error(y[split:] * quantity, np.mean(y[:split]) * quantity))
    usable = mae <= baseline
    pipeline.fit(x, y)
    scaler, regression = pipeline.steps[0][1], pipeline.steps[1][1]
    weights = regression.coef_ / scaler.scale_
    intercept = float(regression.intercept_ - np.dot(weights, scaler.mean_))
    return dict(version=1, algorithm='StandardScaler + Ridge(alpha=10)', features=FEATURES,
                weights=weights.tolist(), intercept=intercept, usable=usable,
                rows=len(rows), training_rows=split, test_rows=len(rows)-split,
                mae_portions=mae, baseline_mae_portions=baseline,
                first_date=rows[0]['offer_date'], last_date=rows[-1]['offer_date'],
                test_from=rows[split]['offer_date'],
                price_ratio_min=float(x[:, 0].min()), price_ratio_max=float(x[:, 0].max()),
                reason='Passed chronological baseline check.' if usable else 'Did not beat the historical mean baseline; fallback remains active.')


if __name__ == '__main__':
    try:
        result = train(json.load(sys.stdin)['rows'])
        print(json.dumps(result, allow_nan=False))
    except (ValueError, KeyError, TypeError) as error:
        print(json.dumps({'error': str(error)}))
        sys.exit(2)
