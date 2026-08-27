export type ShopifyGraphql = (
  query: string,
  options?: { variables?: Record<string, unknown> },
) => Promise<Response>;

interface GraphqlError {
  message?: string;
}

interface GraphqlEnvelope<T> {
  data?: T;
  errors?: GraphqlError[];
}

export interface PageInfo {
  hasNextPage: boolean;
  endCursor: string | null;
}

export function throwShopifyResponse(response: Response): never {
  if (
    response.status < 400 ||
    response.status === 401 ||
    response.headers.has("X-Shopify-API-Request-Failure-Reauthorize-Url") ||
    response.headers.has("X-Shopify-Retry-Invalid-Session-Request")
  ) {
    throw response;
  }

  throw new Error(`Shopify GraphQL request failed (${response.status})`);
}

export async function executeGraphql<T>(
  graphql: ShopifyGraphql,
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  let response: Response;
  try {
    response = await graphql(query, { variables });
  } catch (error) {
    if (error instanceof Response) {
      throwShopifyResponse(error);
    }
    throw error;
  }
  if (!response.ok) {
    throwShopifyResponse(response);
  }

  const envelope = (await response.json()) as GraphqlEnvelope<T>;
  if (envelope.errors?.length) {
    throw new Error(
      envelope.errors
        .map((error) => error.message ?? "Unknown Shopify GraphQL error")
        .join("; "),
    );
  }
  if (envelope.data === undefined) {
    throw new Error("Shopify GraphQL response did not include data");
  }

  return envelope.data;
}

export function requirePageInfo(value: unknown, context: string): PageInfo {
  if (
    typeof value !== "object" ||
    value === null ||
    typeof (value as PageInfo).hasNextPage !== "boolean" ||
    !(
      typeof (value as PageInfo).endCursor === "string" ||
      (value as PageInfo).endCursor === null
    )
  ) {
    throw new Error(`Invalid ${context} page info`);
  }

  const pageInfo = value as PageInfo;
  if (pageInfo.hasNextPage && pageInfo.endCursor === null) {
    throw new Error(`Invalid ${context} page cursor`);
  }
  return pageInfo;
}
