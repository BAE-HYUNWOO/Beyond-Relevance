import numpy as np
from scipy.spatial.distance import jensenshannon

def compute_jsd(p, q):
    return jensenshannon(p, q, base=2) ** 2
