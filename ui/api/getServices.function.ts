import { MonitoredEntitiesClient } from '@dynatrace-sdk/client-classic-environment-v2';
import { httpClient } from '@dynatrace-sdk/http-client';

interface ServiceEntity {
  entityId: string;
  displayName: string;
  [key: string]: unknown;
}

/**
 * App Function to fetch services from Dynatrace
 * Uses the Dynatrace SDK which handles authentication and user IAM permissions automatically
 */
export default async function getServices(): Promise<object> {
  try {
    console.log('App Function: Fetching services via Dynatrace SDK...');

    // Create entities client with platform HTTP client
    // Authentication is handled automatically in Dynatrace environment
    const client = new MonitoredEntitiesClient(httpClient);

    // Fetch services using the SDK
    const response = await client.getEntities({
      entitySelector: 'type("SERVICE")',
    });

    console.log('App Function: Services fetched successfully, count:', response.entities?.length || 0);

    return {
      success: true,
      entities: response.entities || [],
      total: response.entities?.length || 0,
    };
  } catch (error) {
    console.error('App Function Error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      entities: [],
    };
  }
}
