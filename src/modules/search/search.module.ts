import { SearchGeneratedController } from "./controllers/search-generated.controller";
import { SearchGeneratedService } from "./services/search-generated.service";
import { Module } from "@nestjs/common";
import { SearchController } from "./controllers/search.controller";
import { SearchService } from "./services/search.service";
import { SearchConfigService } from "./services/search-config.service";
import { SearchSynonymsService } from "./services/search-synonyms.service";

import { SearchRepository } from "./repositories/search.repository";

@Module({
  controllers: [SearchGeneratedController, SearchController],
  providers: [
    SearchRepository,
    SearchGeneratedService,
    SearchService,
    SearchConfigService,
    SearchSynonymsService,
  ],
  exports: [
    SearchRepository,
    SearchGeneratedService,
    SearchService,
    SearchConfigService,
    SearchSynonymsService,
  ],
})
export class SearchModule {}
