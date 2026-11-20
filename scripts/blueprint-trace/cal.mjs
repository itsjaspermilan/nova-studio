// pixels per model unit (1/16 m) and where (0, 0) is in each view. side/top: u = z (nose to the left: sx -1); front/rear: u = x.
export const CAL = {
  gt: {
    side: { ox: 748.1, oy: 1113, k: 18.43, sx: -1 },
    top: { ox: 749.1, oy: 1680, k: 18.43, sx: -1 },
    front: { ox: 318, oy: 432, k: 18.98, sx: 1 },
    rear: { ox: 1099, oy: 432, k: 18.44, sx: 1 },
  },
  lc: {
    side: { ox: 1466, oy: 495, k: 15.12, ky: 15.64, sx: -1 },
    top: { ox: 1445, oy: 984, k: 15.12, ky: 16.33, sx: -1 },
    front: { ox: 352, oy: 495, k: 16.37, ky: 15.6, sx: 1 },
    rear: { ox: 352, oy: 1256, k: 16.37, ky: 15.6, sx: 1 },
  },
};
