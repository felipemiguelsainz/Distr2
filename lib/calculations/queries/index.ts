// Barrel — punto único de import para la capa de queries.
// Los módulos están separados por dominio: kpis, trend, clientes.
export { fetchMonthInfo, fetchTotalKpis, fetchSupervisorKpis, fetchVendedorKpis } from './kpis';
export { fetchTrendData } from './trend';
export { fetchCCC, fetchCCCByEquipo, fetchClientesData, fetchCobertura, fetchMetasCcc } from './clientes';
