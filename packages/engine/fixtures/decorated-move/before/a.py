@cache
def load(path):
    with open(path) as f:
        return f.read()


ZERO = 0
