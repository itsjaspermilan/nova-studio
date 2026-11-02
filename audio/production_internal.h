#ifndef NOVA_PRODUCTION_INTERNAL_H
#define NOVA_PRODUCTION_INTERNAL_H

#include "production.h"

typedef struct NovaProduction NovaProduction;
typedef struct NovaProductionState NovaProductionState;

bool nova_production_prepare(const NovaAudioProductionDesc *desc, uint32_t rate, uint64_t length,
    size_t buses, size_t base_events, NovaProduction **out, char *error, size_t size);
void nova_production_destroy(NovaProduction *production);
NovaAudioProductionInfo nova_production_info(const NovaProduction *production);
NovaProductionState *nova_production_create(const NovaProduction *production, char *error, size_t size);
void nova_production_free(NovaProductionState *state);
void nova_production_reset(NovaProductionState *state, bool meters);
void nova_production_cancel(NovaProductionState *state, uint32_t frames);
void nova_production_begin(NovaProductionState *state, uint64_t position);
bool nova_production_bus(NovaProductionState *state, uint32_t bus, double value[2]);
void nova_production_sends(NovaProductionState *state, uint32_t bus, bool post_fader,
    double buses[NOVA_AUDIO_MAX_BUSES][2]);
double nova_production_output_gain(const NovaProductionState *state);
void nova_production_advance(NovaProductionState *state);
bool nova_production_finished(const NovaProductionState *state);
NovaAudioProductionStatus nova_production_status(const NovaProductionState *state);

#endif
