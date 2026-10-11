/**
 * Where the worker's logs and metrics live since it moved to a Cloud Run
 * worker pool. Monitored resource `cloud_run_worker_pool` carries
 * worker_pool_name, revision_name, location and configuration_name
 * (https://cloud.google.com/monitoring/api/resources#tag_cloud_run_worker_pool).
 *
 * An alert threshold filter "must specify the metric type and the resource
 * type" (projects.alertPolicies reference), so a signal both the API service
 * and the worker emit needs one condition per resource type. Logging filters
 * have no such limit.
 */
export const WORKER_POOL = 'declutrmail-worker-pool';
export const WORKER_POOL_RESOURCE_TYPE = 'cloud_run_worker_pool';
export const WORKER_POOL_RESOURCE = `resource.type="${WORKER_POOL_RESOURCE_TYPE}" AND resource.labels.worker_pool_name="${WORKER_POOL}"`;
/** PromQL selector labels for the same resource. */
export const WORKER_POOL_PROMQL = `monitored_resource="${WORKER_POOL_RESOURCE_TYPE}",worker_pool_name="${WORKER_POOL}"`;
/** The resource types a line from either the API or the worker is written under. */
export const API_AND_WORKER_RESOURCE_TYPES = ['cloud_run_revision', WORKER_POOL_RESOURCE_TYPE];
/** Logging filter for lines either the API service or the worker pool writes. */
export const API_OR_WORKER_LOGS = `(${API_AND_WORKER_RESOURCE_TYPES.map((type) => `resource.type="${type}"`).join(' OR ')})`;
