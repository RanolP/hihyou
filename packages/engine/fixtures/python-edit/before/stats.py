def mean(values, precision=2):
    total = sum(values)
    return round(total / len(values), precision)
