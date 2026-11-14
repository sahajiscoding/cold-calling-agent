import axios, { AxiosInstance } from "axios";
import { Config } from "../config";
import { logger } from "../logger";

export interface PlaceResult {
  place_id: string;
  name: string;
  formatted_address: string;
  formatted_phone_number?: string;
  website?: string;
  types: string[];
  rating?: number;
  user_ratings_total?: number;
  business_status: string;
  opening_hours?: {
    open_now: boolean;
  };
  geometry: {
    location: {
      lat: number;
      lng: number;
    };
  };
}

export interface ResearchResult {
  businessName: string;
  phoneNumber?: string;
  email?: string;
  address?: string;
  website?: string;
  hasWebsite: boolean;
  hasWhatsApp: boolean;
  category?: string;
  rating?: number;
  reviewsCount?: number;
  placeId: string;
  location?: string;
}

export class GooglePlacesService {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: Config.GOOGLE_PLACES.baseURL,
      timeout: 30000,
    });

    this.client.interceptors.request.use((request) => {
      logger.info("Google Places API request", {
        method: request.method,
        url: request.url,
        params: request.params,
      });
      return request;
    });

    this.client.interceptors.response.use(
      (response) => {
        logger.info("Google Places API response", {
          status: response.status,
          data: response.data,
        });
        return response;
      },
      (error) => {
        logger.error("Google Places API error", {
          status: error.response?.status,
          data: error.response?.data,
          message: error.message,
        });
        return Promise.reject(error);
      }
    );
  }

  // Search for businesses by query and location
  async searchBusinesses(
    query: string,
    location?: string,
    radius?: number
  ): Promise<PlaceResult[]> {
    try {
      const response = await this.client.get("/textsearch/json", {
        params: {
          query: location ? `${query} ${location}` : query,
          key: Config.GOOGLE_PLACES.API_KEY,
          radius: radius || 50000, // 50km default
        },
      });

      if (response.data.status !== "OK" && response.data.status !== "ZERO_RESULTS") {
        throw new Error(`Google Places API error: ${response.data.status}`);
      }

      return response.data.results || [];
    } catch (error: any) {
      logger.error("Failed to search businesses", {
        query,
        location,
        error: error.response?.data || error.message,
      });
      throw error;
    }
  }

  // Get place details including phone number and website
  async getPlaceDetails(placeId: string): Promise<PlaceResult> {
    try {
      const response = await this.client.get("/details/json", {
        params: {
          place_id: placeId,
          fields: "place_id,name,formatted_address,formatted_phone_number,website,types,rating,user_ratings_total,business_status,opening_hours,geometry",
          key: Config.GOOGLE_PLACES.API_KEY,
        },
      });

      if (response.data.status !== "OK") {
        throw new Error(`Google Places API error: ${response.data.status}`);
      }

      return response.data.result;
    } catch (error: any) {
      logger.error("Failed to get place details", {
        placeId,
        error: error.response?.data || error.message,
      });
      throw error;
    }
  }

  // Transform Google Places result to ResearchResult
  transformToResearchResult(place: PlaceResult): ResearchResult {
    const hasWebsite = !!place.website;
    const phoneNumber = place.formatted_phone_number;

    return {
      businessName: place.name,
      phoneNumber,
      email: undefined, // Google Places doesn't provide email
      address: place.formatted_address,
      website: place.website,
      hasWebsite,
      hasWhatsApp: false, // Will be verified separately if needed
      category: place.types[0],
      rating: place.rating,
      reviewsCount: place.user_ratings_total,
      placeId: place.place_id,
      location: `${place.geometry.location.lat},${place.geometry.location.lng}`,
    };
  }

  // Search and get details for multiple businesses
  async researchBusinesses(
    query: string,
    location?: string,
    maxResults: number = 20
  ): Promise<ResearchResult[]> {
    logger.info("Starting business research", { query, location, maxResults });

    const places = await this.searchBusinesses(query, location);
    const results: ResearchResult[] = [];

    // Process up to maxResults
    for (const place of places.slice(0, maxResults)) {
      try {
        const details = await this.getPlaceDetails(place.place_id);
        results.push(this.transformToResearchResult(details));

        // Add small delay to respect rate limits
        await new Promise((resolve) => setTimeout(resolve, 200));
      } catch (error) {
        logger.warn("Failed to get details for place", {
          placeId: place.place_id,
          name: place.name,
          error,
        });
        // Continue with next place
      }
    }

    logger.info("Business research completed", {
      query,
      totalFound: places.length,
      processed: results.length,
    });

    return results;
  }

  // Filter businesses without websites
  filterBusinessesWithoutWebsite(results: ResearchResult[]): ResearchResult[] {
    const filtered = results.filter((r) => !r.hasWebsite);
    logger.info("Filtered businesses without website", {
      total: results.length,
      withoutWebsite: filtered.length,
    });
    return filtered;
  }
}

export default GooglePlacesService;