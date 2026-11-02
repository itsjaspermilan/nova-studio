#ifndef NOVA_TRANSFORM_H
#define NOVA_TRANSFORM_H

#include "nova.h"

/* Right-handed degrees: local scale, X then Y then Z rotation, translation.
 * The pivot is the local origin. Inverse operations require positive scales. */
bool nova_rotation_valid(NovaVec3 degrees);
/* Finite runtime input in degrees -> [-180, 180). Normalize before float conversion. */
float nova_angle_normalize(double degrees);
NovaVec3 nova_rotate(NovaVec3 point, NovaVec3 degrees);
NovaVec3 nova_unrotate(NovaVec3 point, NovaVec3 degrees);
NovaVec3 nova_transform_point(NovaVec3 point, NovaVec3 position, NovaVec3 size, NovaVec3 rotation);
NovaVec3 nova_inverse_direction(NovaVec3 direction, NovaVec3 size, NovaVec3 rotation);
NovaVec3 nova_inverse_point(NovaVec3 point, NovaVec3 position, NovaVec3 size, NovaVec3 rotation);
void nova_transform_bounds(NovaVec3 minimum, NovaVec3 maximum, NovaVec3 position,
    NovaVec3 size, NovaVec3 rotation, NovaVec3 *world_minimum, NovaVec3 *world_maximum);
/* Intersect the transformed local box, not its looser world AABB. Distance is
 * the original ray parameter (world distance for a unit direction). */
bool nova_ray_box(NovaVec3 origin, NovaVec3 direction, NovaVec3 minimum,
    NovaVec3 maximum, NovaVec3 position, NovaVec3 size, NovaVec3 rotation, float *distance);

#endif
