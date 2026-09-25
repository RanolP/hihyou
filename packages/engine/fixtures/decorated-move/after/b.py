ONE = 1


@cache
def load(path, encoding):
    with open(path, encoding=encoding) as f:
        return f.read()
