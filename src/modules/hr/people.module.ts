import { PeopleGeneratedController } from "./controllers/people-generated.controller";
import { PeopleGeneratedService } from "./services/people-generated.service";
import { Module } from "@nestjs/common";
import { PeopleController } from "./controllers/people.controller";
import { PeopleService } from "./services/people.service";
import { PeopleCompetenciesService } from "./services/people-competencies.service";
import { PeopleSuccessionService } from "./services/people-succession.service";

import { PeopleRepository } from "./repositories/people.repository";

@Module({
  controllers: [PeopleGeneratedController, PeopleController],
  providers: [
    PeopleRepository,
    PeopleGeneratedService,
    PeopleService,
    PeopleCompetenciesService,
    PeopleSuccessionService,
  ],
  exports: [
    PeopleRepository,
    PeopleGeneratedService,
    PeopleService,
    PeopleCompetenciesService,
    PeopleSuccessionService,
  ],
})
export class PeopleModule {}
