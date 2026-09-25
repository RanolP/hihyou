def mean(values, precision=3):
    if not values:
        return 0.0
    total = sum(values)
    return round(total / len(values), precision)
