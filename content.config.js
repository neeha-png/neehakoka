import { defineCollection, z } from 'astro:content';

const blog = defineCollection({
  // No loader import needed! Astro v6 automatically looks inside src/content/[collection_name]
  type: 'content', 
  schema: z.object({
    title: z.string(),
    pubDate: z.coerce.date(),
    description: z.string(),
  }),
});

export const collections = { blog };