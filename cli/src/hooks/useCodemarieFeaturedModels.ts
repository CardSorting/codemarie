import { type FeaturedModel, getAllFeaturedModels } from "../constants/featured-models"

export function useCodemarieFeaturedModels(): FeaturedModel[] {
	return getAllFeaturedModels()
}
