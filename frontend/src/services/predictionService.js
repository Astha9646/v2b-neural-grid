
import api from "./api";

export const runOptimization = async (state) => {

  const response = await api.post("/predict", state);

  return response.data;
};

